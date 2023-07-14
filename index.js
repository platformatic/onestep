'use strict'

const { execSync } = require('node:child_process')

function installDependencies () {
  console.log('Installing platformatic dependencies...')
  try {
    const result = execSync('npm install --omit=dev', {
      cwd: __dirname,
      timeout: 2 * 60 * 1000
    })
    console.log(result.toString())
  } catch (error) {
    console.error('Failed to install platformatic dependencies.', error)
    process.exit(1)
  }
}

installDependencies()

require('./action.js')()
