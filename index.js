"use strict"

const fs = require('fs')
const path = require('path')
const child_process = require('child_process')

module.exports = {
  hooks: {
    'page:before': function (page) {
      const options = Object.assign({problem: 'error'}, this.options.pluginsConfig["snippet"])
      const problem = (filename, message) => {
        const fullMessage = `${filename}: ${message}\n`
        switch (options.problem) {
          case 'warn': {
            this.log.warn(fullMessage)
            break
          }
          case 'error': {
            this.log.error(fullMessage)
            break
          }
          case 'fail': {
            throw new Error(fullMessage)
          }
        }
        return message
      }

      const dir = path.dirname(page.rawPath)
      const sourceByFilepath = {}
      const readFilePromises = []

      const readFile = (filepath) => {
        return new Promise((resolve) => {
          fs.readFile(filepath, "utf-8", (err, source) => {
            if (err) return resolve() // We'll error later, when the file is not found
            sourceByFilepath[filepath] = source
            resolve()
          })
        })
      }

      const gitCat = (commitMessage, filepath) => {
        return new Promise((resolve) => {
          child_process.exec(`${__dirname}/bin/gitcat "${commitMessage}" "${filepath}"`, (err, source) => {
            if (err) return resolve() // We'll error later, when the file is not found
            sourceByFilepath[filepath] = source
            resolve()
          })
        })
      }

      const snippetRegexp = /^\s*\[(?:un)?snippet\]\(([^#\)]+)#?([^\)@]+)?@?([^\)]+)?\)\s*$/gm

      // find all [snippet]() statements,
      // read and cache target files
      let snippetMatch
      while (snippetMatch = snippetRegexp.exec(page.content)) {
        const filename = snippetMatch[1]
        const commitMessage = snippetMatch[3]
        const filepath = path.join(dir, filename)

        console.log( filename, commitMessage, filepath );

        const promise = commitMessage ? gitCat(commitMessage, filepath) : readFile(filepath)
        readFilePromises.push(promise)
      }

      // once all files are read, replace snippet statements with
      // appropriate file content
      return Promise.all(readFilePromises)
        .then(() => {
          page.content = page.content.replace(snippetRegexp, (snippetLink, filename, fragment) => {
            console.log( "in", snippetLink )
            const shouldUnindent = snippetLink.startsWith('[un')
            console.log( "another", shouldUnindent )
            const filepath = path.join(dir, filename)
            const source = sourceByFilepath[filepath]
            if (!source) return problem(filename, `${snippetLink} *FILE NOT FOUND: ${filename}*`)
            if (!fragment) return removeMarkers(source)
            // find the content between two anchors, which can be "### [fragment-nane]" or "/// [fragment-nane]"
            const fragmentRegexp = new RegExp(`[\\s\\S]*(?:###|\\/\\/\\/)\\s*\\[${fragment}\\][^\\n]*\\n([\\s\\S]*)(?:\\n[^\\n]*###|\\/\\/\\/)\\s*\\[${fragment}\\]`)
            const fragmentMatch = source.match(fragmentRegexp)
            if (!fragmentMatch) return problem(filename, `${snippetLink} *FRAGMENT NOT FOUND: ${filename}#${fragment}*`)
            return removeMarkers(shouldUnindent? unindent(fragmentMatch[1]) : fragmentMatch[1] )
          })
          return page
        })
    }
  }
}

const unindent = s => {
  // https://twitter.com/gasparnagy/status/778134306128551940
  for (; !s.match(/^\S/m); s = s.replace(/^\s/gm, ''));
  return s
}

const removeMarkers = s => {
  const markerRegexp = new RegExp(`(?:\\n[^\\n]*###|\\/\\/\\/)\\s*\\[[^\\]]*\\]`, 'g' );
  s = s.replace( markerRegexp, '' );
  return s;
}
