'use strict'

const { join } = require('path')
const { writeFile } = require('fs/promises')

const fastify = require('fastify')
const nock = require('nock')

async function createRepository (actionFolder, repositoryOptions = {}) {
  const commitSha = '1234'

  const owner = repositoryOptions.owner || 'test-github-user'
  const repositoryName = repositoryOptions.name || 'test-repo-name'

  const prNumber = repositoryOptions.pullRequest?.number || 1
  const prTitle = repositoryOptions.pullRequest?.title || 'Test PR title'

  const payload = {
    repository: {
      id: 1234,
      name: repositoryName,
      html_url: `https://github.com/${owner}/${repositoryName}`,
      owner: { login: owner }
    }
  }

  const eventName = process.env.GITHUB_EVENT_NAME
  if (eventName === 'pull_request') {
    process.env.GITHUB_HEAD_REF = 'test'
    process.env.GITHUB_REF_NAME = ''
    payload.pull_request = {
      number: prNumber,
      head: {
        sha: commitSha
      }
    }
  } else if (eventName === 'push') {
    process.env.GITHUB_REF_NAME = 'test'
    process.env.GITHUB_HEAD_REF = ''
    payload.head_commit = {
      id: commitSha
    }
  } else if (eventName === 'workflow_dispatch') {
    process.env.GITHUB_REF_NAME = 'test'
    process.env.GITHUB_HEAD_REF = ''
    payload.head_commit = {
      id: commitSha
    }
  }

  const githubEventConfigPath = join(actionFolder, 'github_event.json')
  await writeFile(githubEventConfigPath, JSON.stringify(payload))

  process.env.GITHUB_EVENT_PATH = githubEventConfigPath

  startGithubApi(owner, repositoryName, commitSha, prNumber, prTitle)
}

function startGithubApi (owner, repositoryName, commitSha, prNumber, prTitle) {
  nock('https://api.github.com')
    .post(`/repos/${owner}/${repositoryName}/issues/${prNumber}/comments`)
    .reply(200, {})

  nock('https://api.github.com')
    .get(`/repos/${owner}/${repositoryName}/issues/${prNumber}/comments`)
    .reply(200, [])

  nock('https://api.github.com')
    .get(`/repos/${owner}/${repositoryName}/pulls/${prNumber}`)
    .reply(200, { title: prTitle, number: prNumber })

  const commitAuthor = process.env.UNKNOWN_COMMIT_AUTHOR ? null : { login: owner }

  nock('https://api.github.com')
    .get(`/repos/${owner}/${repositoryName}/commits/${commitSha}`)
    .reply(200, {
      sha: commitSha,
      author: commitAuthor,
      stats: {
        additions: 1,
        deletions: 1
      }
    })
}

async function startDeployService (t, options) {
  const deployService = fastify({ keepAliveTimeout: 1 })

  deployService.post('/bundles', async (request, reply) => {
    const createBundleCallback = options.createBundleCallback || (() => {})
    await createBundleCallback(request, reply)

    return {
      id: 'default-bundle-id',
      token: 'default-upload-token',
      isBundleUploaded: false
    }
  })

  deployService.post('/deployments', async (request, reply) => {
    const createDeploymentCallback = options.createDeploymentCallback
    await createDeploymentCallback(request, reply)
  })

  deployService.addContentTypeParser(
    'application/x-tar',
    { bodyLimit: 1024 * 1024 * 1024 },
    (request, payload, done) => done()
  )

  deployService.put('/upload', async (request, reply) => {
    const uploadCallback = options.uploadCallback || (() => {})
    await uploadCallback(request, reply)
  })

  t.teardown(async () => {
    await deployService.close()
  })

  await deployService.listen({ port: 3042 })
  return deployService
}

async function startMachine (t, callback = () => {}) {
  const machine = fastify({ keepAliveTimeout: 1 })

  machine.get('/', async (request, reply) => {
    await callback(request, reply)
  })

  t.teardown(async () => {
    await machine.close()
  })

  return machine.listen({ port: 0 })
}

module.exports = {
  createRepository,
  startDeployService,
  startMachine
}
