'use strict'

const { join, basename } = require('path')
const { createHash } = require('crypto')
const { existsSync } = require('fs')
const { readFile, writeFile, access, readdir } = require('fs/promises')

const core = require('@actions/core')
const github = require('@actions/github')
const tar = require('tar')
const { request } = require('undici')
require('dotenv').config({ path: join(__dirname, '.env') })

const makePrewarmRequest = require('./lib/prewarm.js')

const STEVE_SERVER_URL = core.getInput('steve_server_url') || process.env.STEVE_SERVER_URL
const HARRY_SERVER_URL = core.getInput('harry_server_url') || process.env.HARRY_SERVER_URL

const PLT_MESSAGE_REGEXP = /\*\*Your application was successfully deployed!\*\* :rocket:\nApplication url: (.*).*/
const APPLICATION_TYPES = ['service', 'db']
const CONFIG_FILE_EXTENSIONS = ['yml', 'yaml', 'json', 'json5', 'tml', 'toml']

const PLATFORMATIC_ENV_VARS = ['PORT', 'DATABASE_URL']

async function archiveProject (pathToProject, archivePath) {
  const options = { gzip: false, file: archivePath, cwd: pathToProject }
  return tar.create(options, ['.'])
}

async function createBundle (
  workspaceId,
  workspaceKey,
  label,
  appType,
  pullRequestDetails,
  configPath,
  codeChecksum
) {
  const url = STEVE_SERVER_URL + '/bundles'

  const { statusCode, body } = await request(url, {
    method: 'POST',
    headers: {
      'x-platformatic-workspace-id': workspaceId,
      'x-platformatic-api-key': workspaceKey,
      'content-type': 'application/json',
      'accept-encoding': '*',
      accept: 'application/json'
    },
    body: JSON.stringify({
      label,
      bundle: {
        appType,
        workspaceId,
        configPath,
        codeChecksum
      },
      repository: {
        name: pullRequestDetails.base.repo.name,
        url: pullRequestDetails.base.repo.html_url,
        githubRepoId: pullRequestDetails.base.repo.id
      },
      branch: {
        name: pullRequestDetails.head.ref
      },
      commit: {
        sha: pullRequestDetails.head.sha,
        username: pullRequestDetails.head.user.login,
        additions: pullRequestDetails.additions,
        deletions: pullRequestDetails.deletions
      },
      pullRequest: {
        title: pullRequestDetails.title,
        number: pullRequestDetails.number
      }
    })
  })

  if (statusCode !== 200) {
    if (statusCode === 401) {
      throw new Error('Invalid platformatic_api_key provided')
    }
    throw new Error(`Could not create a bundle: ${statusCode}`)
  }

  return body.json()
}

async function uploadCodeArchive (uploadToken, fileData) {
  const url = HARRY_SERVER_URL + '/upload'
  const { statusCode } = await request(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/x-tar',
      authorization: `Bearer ${uploadToken}`
    },
    body: fileData,
    headersTimeout: 60 * 1000
  })

  if (statusCode !== 200) {
    throw new Error(`Failed to upload code archive: ${statusCode}`)
  }
}

async function createDeployment (
  workspaceId,
  workspaceKey,
  bundleId,
  entryPointId
) {
  const url = STEVE_SERVER_URL + `/bundles/${bundleId}/deployment`

  const { statusCode, body } = await request(url, {
    method: 'POST',
    headers: {
      'x-platformatic-workspace-id': workspaceId,
      'x-platformatic-api-key': workspaceKey,
      'content-type': 'application/json',
      'accept-encoding': '*',
      accept: 'application/json'
    },

    body: JSON.stringify({ entryPointId })
  })

  if (statusCode !== 200) {
    if (statusCode === 401) {
      throw new Error('Invalid platformatic_api_key provided')
    }
    throw new Error(`Could not create a deployment: ${statusCode}`)
  }

  return body.json()
}

function generateMD5Hash (buffer) {
  return createHash('md5').update(buffer).digest('base64')
}

async function getPullRequestDetails (octokit) {
  const pullRequestInfo = github.context.payload.pull_request

  const { data: pullRequestDetails } = await octokit.rest.pulls.get({
    owner: pullRequestInfo.base.repo.owner.login,
    repo: pullRequestInfo.base.repo.name,
    pull_number: pullRequestInfo.number
  })

  return pullRequestDetails
}

function getGithubEnvVariables (allowedEnvVars) {
  const upperCaseAllowedEnvVars = []
  for (const allowedEnvVar of allowedEnvVars) {
    upperCaseAllowedEnvVars.push(allowedEnvVar.toUpperCase().trim())
  }

  const userEnvVars = {}
  for (const key in process.env) {
    const upperCaseKey = key.toUpperCase().trim()
    if (
      PLATFORMATIC_ENV_VARS.includes(upperCaseKey) ||
      upperCaseAllowedEnvVars.includes(upperCaseKey) ||
      upperCaseKey.startsWith('PLT_')
    ) {
      userEnvVars[upperCaseKey] = process.env[key]
    }
  }
  return userEnvVars
}

function serializeEnvVariables (envVars) {
  let serializedEnvVars = ''
  for (const key in envVars) {
    serializedEnvVars += `${key}=${envVars[key]}\n`
  }
  return serializedEnvVars
}

function parseEnvVariables (envVars) {
  const parsedEnvVars = {}
  for (const line of envVars.split('\n')) {
    if (line === '') continue
    const [key, value] = line.split('=')
    parsedEnvVars[key] = value
  }
  return parsedEnvVars
}

async function findConfigFile (projectDir) {
  const files = await readdir(projectDir)

  for (const file of files) {
    const filename = basename(file)
    const filenameParts = filename.split('.')

    if (filenameParts.length === 3) {
      const [name, ext1, ext2] = filenameParts
      if (
        name === 'platformatic' &&
        APPLICATION_TYPES.includes(ext1) &&
        CONFIG_FILE_EXTENSIONS.includes(ext2)
      ) {
        return filename
      }
    }
  }

  return null
}

async function mergeEnvVariables (envFilePath, githubEnvVars) {
  if (Object.keys(githubEnvVars).length === 0) return

  let userEnvVars = {}
  if (existsSync(envFilePath)) {
    const userEnvFile = await readFile(envFilePath, 'utf8')
    userEnvVars = parseEnvVariables(userEnvFile)
  }

  const mergedEnvVars = { ...githubEnvVars, ...userEnvVars }
  await writeFile(envFilePath, serializeEnvVariables(mergedEnvVars))
}

function getApplicationType (configPath) {
  const appType = configPath.split('.').slice(-2)[0]
  if (!APPLICATION_TYPES.includes(appType)) {
    throw new Error(`Invalid application type: ${appType}, must be one of: ${APPLICATION_TYPES.join(', ')}`)
  }
  return appType
}

/* istanbul ignore next */
async function findLastPlatformaticComment (octokit) {
  const pullRequestInfo = github.context.payload.pull_request

  const { data: comments } = await octokit.rest.issues.listComments({
    owner: pullRequestInfo.base.repo.owner.login,
    repo: pullRequestInfo.base.repo.name,
    issue_number: pullRequestInfo.number
  })

  const platformaticComments = comments
    .filter(comment =>
      comment.user.login === 'github-actions[bot]' &&
        PLT_MESSAGE_REGEXP.test(comment.body)
    )
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))

  if (platformaticComments.length === 0) {
    return null
  }

  const lastComment = platformaticComments[platformaticComments.length - 1]
  return lastComment.id
}

function createPlatformaticComment (applicationUrl, commitHash, commitUrl) {
  return [
    '**Your application was successfully deployed!** :rocket:',
    `Application url: ${applicationUrl}`,
    `Built from the commit: [${commitHash.slice(0, 7)}](${commitUrl})`
  ].join('\n')
}

async function isFileAccessible (path) {
  try {
    await access(path)
    return true
  } catch (err) {
    return false
  }
}

async function postPlatformaticComment (octokit, comment) {
  const pullRequestInfo = github.context.payload.pull_request

  await octokit.rest.issues.createComment({
    ...github.context.repo,
    issue_number: pullRequestInfo.number,
    body: comment
  })
}

async function checkPlatformaticDependency (projectPath) {
  const packageJsonPath = join(projectPath, 'package.json')

  const packageJsonExist = await isFileAccessible(packageJsonPath)
  if (!packageJsonExist) return

  const packageJsonData = await readFile(packageJsonPath, 'utf8')
  const packageJson = JSON.parse(packageJsonData)

  const dependencies = packageJson.dependencies
  if (
    dependencies !== undefined &&
    dependencies.platformatic !== undefined
  ) {
    core.warning('Move platformatic dependency to devDependencies to speed up deployment')
  }
}

/* istanbul ignore next */
async function updatePlatformaticComment (octokit, commentId, comment) {
  await octokit.rest.issues.updateComment({
    ...github.context.repo,
    comment_id: commentId,
    body: comment
  })
}

async function run () {
  try {
    // const workspaceId = 'af931129-04be-4178-a2ea-1f481a3de2f1'
    // const workspaceKey = 'test'
    const workspaceId = core.getInput('platformatic_workspace_id')
    const workspaceKey = core.getInput('platformatic_workspace_key')

    if (!workspaceId) {
      throw new Error('There is no Platformatic workspace id')
    }

    if (!workspaceKey) {
      throw new Error('There is no Platformatic workspace key')
    }

    if (github.context.payload.pull_request === undefined) {
      throw new Error('Action must be triggered by pull request')
    }

    const githubToken = core.getInput('github_token')
    const octokit = github.getOctokit(githubToken)

    const pullRequestDetails = await getPullRequestDetails(octokit)

    // const pullRequestDetails = {
    //   head: {
    //     ref: 'test',
    //     repo: {
    //       full_name: 'test'
    //     },
    //     sha: 'test',
    //     user: {
    //       login: 'test'
    //     }
    //   },
    //   base: {
    //     repo: {
    //       id: 0,
    //       name: 'test',
    //       html_url: 'test'
    //     }
    //   },
    //   additions: 0,
    //   deletions: 0,
    //   number: 0,
    //   title: 'test'
    // }

    const pathToProject = process.env.GITHUB_WORKSPACE
    // const pathToProject = '../../platformatic/test-platformatic-deploy-action-2'

    await checkPlatformaticDependency(pathToProject)

    let configPath = core.getInput('platformatic_config_path')
    if (!configPath) {
      configPath = await findConfigFile(pathToProject)

      if (configPath === null) {
        throw new Error('Could not find Platformatic config file, please specify it in the action input')
      } else {
        core.info(`Found Platformatic config file: ${configPath}`)
      }
    }

    const appType = getApplicationType(configPath)

    const configAbsolutePath = join(pathToProject, configPath)
    const configFileExist = await isFileAccessible(configAbsolutePath)

    if (!configFileExist) {
      throw new Error('There is no Platformatic config file')
    }

    core.info('Merging environment variables')
    const allowedEnvVarParam = core.getInput('allowed_env_vars') || ''
    const allowedEnvVar = allowedEnvVarParam.split(',')
    const githubEnvVars = getGithubEnvVariables(allowedEnvVar)

    const envFileName = core.getInput('platformatic_env_path') || '.env'
    const envFilePath = join(pathToProject, envFileName)
    await mergeEnvVariables(envFilePath, githubEnvVars)

    const archivePath = join(pathToProject, '..', 'project.tar')
    await archiveProject(pathToProject, archivePath)
    core.info('Project has been successfully archived')

    const fileData = await readFile(archivePath)
    const codeChecksum = generateMD5Hash(fileData)

    const label = `github-pr:${pullRequestDetails.number}`

    const {
      bundleId,
      uploadToken,
      entryPointId,
      entryPointUrl
    } = await createBundle(
      workspaceId,
      workspaceKey,
      label,
      appType,
      pullRequestDetails,
      configPath,
      codeChecksum
    )

    core.info('Uploading code archive to the cloud...')
    await uploadCodeArchive(uploadToken, fileData)
    core.info('Project has been successfully uploaded')

    await createDeployment(workspaceId, workspaceKey, bundleId, entryPointId)
    core.info('Application has been successfully created')
    core.info('Application URL: ' + entryPointUrl)

    try {
      core.info('Making prewarm application call...')
      await makePrewarmRequest(entryPointUrl)
      core.info('Application has been successfully prewarmed')
    } catch (error) {
      core.error('Could not make a prewarm call')
      core.setFailed(error.message)
      return
    }

    const commitHash = pullRequestDetails.head.sha
    const commitUrl = pullRequestDetails.head.repo.html_url + '/commit/' + commitHash
    const platformaticComment = createPlatformaticComment(entryPointUrl, commitHash, commitUrl)

    const lastCommentId = await findLastPlatformaticComment(octokit)
    /* istanbul ignore next */
    if (lastCommentId === null) {
      await postPlatformaticComment(octokit, platformaticComment)
    } else {
      await updatePlatformaticComment(octokit, lastCommentId, platformaticComment)
    }

    core.setOutput('platformatic_app_url', entryPointUrl)
  } catch (error) {
    core.setFailed(error.message)
  }
}

module.exports = run
