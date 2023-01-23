'use strict'

const { join } = require('path')
const { writeFile } = require('fs/promises')

const fastify = require('fastify')
const nock = require('nock')

async function createRepository (actionFolder, repositoryOptions = {}) {
  const owner = repositoryOptions.owner || 'test-github-user'
  const repositoryName = repositoryOptions.name || 'test-repo-name'

  const prNumber = repositoryOptions.pullRequest?.number || 1
  const prTitle = repositoryOptions.pullRequest?.title || 'Test PR title'

  const payload = {
    pull_request: {
      number: prNumber,
      base: {
        repo: {
          owner: {
            login: owner
          },
          name: repositoryName
        }
      }
    },
    repository: {
      name: repositoryName,
      html_url: `https://github.com/${owner}/${repositoryName}`,
      owner: {
        login: owner
      }
    }
  }

  const githubEventConfigPath = join(actionFolder, 'github_event.json')
  await writeFile(githubEventConfigPath, JSON.stringify(payload))
  process.env.GITHUB_EVENT_PATH = githubEventConfigPath

  startGithubApi(owner, repositoryName, prNumber, prTitle)
}

function startGithubApi (owner, repositoryName, prNumber, prTitle) {
  nock('https://api.github.com')
    .post(`/repos/${owner}/${repositoryName}/issues/${prNumber}/comments`)
    .reply(200, {})

  nock('https://api.github.com')
    .get(`/repos/${owner}/${repositoryName}/issues/${prNumber}/comments`)
    .reply(200, [])

  nock('https://api.github.com')
    .get(`/repos/${owner}/${repositoryName}/pulls/${prNumber}`)
    .reply(200, {
      head: {
        sha: '1234',
        ref: 'test',
        repo: {
          full_name: `${owner}/${repositoryName}`,
          html_url: `https://github.com/${owner}/${repositoryName}`
        },
        user: {
          login: owner
        }
      },
      title: prTitle,
      number: prNumber,
      additions: 1,
      deletions: 1
    })
}

async function startControlPanel (t, options = {}) {
  const controlPanel = fastify({ keepAliveTimeout: 1 })

  controlPanel.post('/bundles', async (request, reply) => {
    const createBundleCallback = options.createBundleCallback || (() => {})
    await createBundleCallback(request, reply)

    return {
      bundleId: 'default-bundle-id',
      uploadToken: 'default-upload-token'
    }
  })

  controlPanel.post('/bundles/:bundleId/deployment', async (request, reply) => {
    const createDeploymentCallback = options.createDeploymentCallback || (() => {})
    await createDeploymentCallback(request, reply)

    return { url: 'http://localhost:3044' }
  })

  t.teardown(async () => {
    await controlPanel.close()
  })
  await controlPanel.listen({ port: 3042 })
  return controlPanel
}

async function startHarry (t, uploadCallback = () => {}) {
  const harry = fastify({ keepAliveTimeout: 1 })

  harry.addContentTypeParser(
    'application/x-tar',
    { bodyLimit: 1024 * 1024 * 1024 },
    (request, payload, done) => done()
  )

  harry.put('/upload', async (request, reply) => {
    await uploadCallback(request, reply)
  })

  t.teardown(async () => {
    await harry.close()
  })
  await harry.listen({ port: 3043 })
  return harry
}

async function startMachine (t, callback) {
  const machine = fastify({ keepAliveTimeout: 1 })

  machine.get('/', async (request, reply) => {
    await callback(request, reply)
  })

  t.teardown(async () => {
    await machine.close()
  })
  await machine.listen({ port: 3044 })
  return machine
}

module.exports = {
  createRepository,
  startControlPanel,
  startHarry,
  startMachine,
  startGithubApi
}
