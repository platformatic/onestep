'use strict'

const { join } = require('path')
const { access } = require('fs/promises')

const core = require('@actions/core')
const tar = require('tar')

async function archiveProject (pathToProject, archivePath) {
  const options = { gzip: true, file: archivePath, cwd: pathToProject }
  return tar.create(options, ['.'])
}

async function uploadFile (filePath) {
  try {
    await access(filePath)
  } catch (error) {
    throw new Error(`Archive not found at ${filePath}`)
  }

  console.log('Uploading archive to the Cloud')
  console.log(`Archive path: ${filePath}`)
}

async function run () {
  try {
    const pathToProject = process.env.GITHUB_WORKSPACE
    const archivePath = join(pathToProject, 'project.tar.gz')

    await archiveProject(pathToProject, archivePath)
    await uploadFile(archivePath)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
