'use strict'

const { tmpdir } = require('os')
const { join } = require('path')
const { mkdtemp, cp, rm } = require('fs/promises')

const { createRepository } = require('./helper.js')

const defaultEnvVars = {
  GITHUB_WORKSPACE: '',
  DEPLOY_SERVICE_HOST: 'http://localhost:3042'
}

async function run () {
  const testProjectName = process.argv[2] || 'basic'

  const projectPath = join(__dirname, 'fixtures', testProjectName)
  const actionFolder = await mkdtemp(join(tmpdir(), 'action_env_'))
  const repositoryPath = await mkdtemp(join(actionFolder, 'repository'))
  await cp(projectPath, repositoryPath, { recursive: true })

  if (process.env.GITHUB_EVENT_PATH !== 'skip') {
    await createRepository(actionFolder)
  }

  process.env = Object.assign({}, defaultEnvVars, process.env)
  process.env[`INPUT_${'platformatic_project_path'.replace(/ /g, '_').toUpperCase()}`] = repositoryPath

  try {
    const executeAction = require('../action.js')
    await executeAction()
  } finally {
    await rm(actionFolder, { recursive: true })
  }
}

run()
