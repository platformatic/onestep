'use strict'

const { join } = require('path')

const core = require('@actions/core')
const github = require('@actions/github')
require('dotenv').config({ path: join(__dirname, '.env') })

const { deploy } = require('./lib/deploy.js')

const PLT_MESSAGE_REGEXP = /\*\*Your application was successfully deployed!\*\* :rocket:\nApplication url: (.*).*/

// TODO: move port and database_url to secrets
const PLATFORMATIC_VARIABLES = ['PORT', 'DATABASE_URL']
const PLATFORMATIC_SECRETS = []

function getRepositoryMetadata () {
  const context = github.context.payload

  return {
    name: context.repository.name,
    url: context.repository.html_url,
    githubRepoId: context.repository.id
  }
}

function getBranchMetadata () {
  const headRef = process.env.GITHUB_HEAD_REF
  const refName = process.env.GITHUB_REF_NAME
  const branchName = headRef || refName

  return { name: branchName }
}

async function getHeadCommitMetadata (octokit) {
  const context = github.context.payload

  const { data: commitDetails } = await octokit.rest.repos.getCommit({
    owner: context.repository.owner.login,
    repo: context.repository.name,
    ref: context.after
  })

  return {
    sha: commitDetails.sha,
    username: commitDetails.author.login,
    additions: commitDetails.stats.additions,
    deletions: commitDetails.stats.deletions
  }
}

async function getPullRequestMetadata (octokit) {
  const context = github.context.payload

  const { data: pullRequestDetails } = await octokit.rest.pulls.get({
    owner: context.repository.owner.login,
    repo: context.repository.name,
    pull_number: context.pull_request.number
  })

  return {
    title: pullRequestDetails.title,
    number: pullRequestDetails.number
  }
}

async function getGithubMetadata (octokit, isPullRequest) {
  const repositoryMetadata = getRepositoryMetadata()
  const branchMetadata = getBranchMetadata()
  const commitMetadata = await getHeadCommitMetadata(octokit)

  const githubMetadata = {
    repository: repositoryMetadata,
    branch: branchMetadata,
    commit: commitMetadata
  }

  if (isPullRequest) {
    const pullRequestMetadata = await getPullRequestMetadata(octokit)
    githubMetadata.pullRequest = pullRequestMetadata
  }

  return githubMetadata
}

function getGithubEnvVariables (variablesNames) {
  const upperCasedVariablesNames = []
  for (const variableName of variablesNames) {
    upperCasedVariablesNames.push(variableName.toUpperCase().trim())
  }

  const userEnvVars = {}
  for (const key in process.env) {
    const upperCaseKey = key.toUpperCase().trim()
    if (
      PLATFORMATIC_VARIABLES.includes(upperCaseKey) ||
      upperCasedVariablesNames.includes(upperCaseKey) ||
      upperCaseKey.startsWith('PLT_')
    ) {
      userEnvVars[upperCaseKey] = process.env[key]
    }
  }
  return userEnvVars
}

function getGithubSecrets (secretsNames) {
  const upperCasedSecretsNames = []
  for (const secretName of secretsNames) {
    upperCasedSecretsNames.push(secretName.toUpperCase().trim())
  }

  const secrets = {}
  for (const key in process.env) {
    const upperCaseKey = key.toUpperCase().trim()
    if (
      PLATFORMATIC_SECRETS.includes(upperCaseKey) ||
      upperCasedSecretsNames.includes(upperCaseKey)
    ) {
      secrets[upperCaseKey] = process.env[key]
    }
  }
  return secrets
}

/* istanbul ignore next */
async function findLastPlatformaticComment (octokit) {
  const context = github.context.payload

  const { data: comments } = await octokit.rest.issues.listComments({
    owner: context.repository.owner.login,
    repo: context.repository.name,
    issue_number: context.pull_request.number
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

async function postPlatformaticComment (octokit, comment) {
  const context = github.context.payload

  await octokit.rest.issues.createComment({
    owner: context.repository.owner.login,
    repo: context.repository.name,
    issue_number: context.pull_request.number,
    body: comment
  })
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
    const eventName = process.env.GITHUB_EVENT_NAME
    if (eventName !== 'push' && eventName !== 'pull_request') {
      throw new Error('The action only works on push and pull_request events')
    }

    const workspaceId = core.getInput('platformatic_workspace_id')
    const workspaceKey = core.getInput('platformatic_workspace_key')

    const pathToConfig = core.getInput('platformatic_config_path')
    const pathToEnvFile = core.getInput('platformatic_env_path')

    const pathToProject = process.env.GITHUB_WORKSPACE
    const deployServiceHost = process.env.DEPLOY_SERVICE_HOST

    const githubToken = core.getInput('github_token')
    const octokit = github.getOctokit(githubToken)

    const isPullRequest = github.context.eventName === 'pull_request'
    const githubMetadata = await getGithubMetadata(octokit, isPullRequest)

    core.info('Getting environment secrets')
    const secretsParam = core.getInput('secrets') || ''
    const secretsNames = secretsParam.split(',')
    const secrets = getGithubSecrets(secretsNames)

    core.info('Getting environment variables')
    const envVariablesParam = core.getInput('variables') || ''
    const envVariablesNames = envVariablesParam.split(',')
    const envVariables = getGithubEnvVariables(envVariablesNames)

    const label = isPullRequest
      ? `github-pr:${githubMetadata.pullRequest.number}`
      : `github-branch:${githubMetadata.branch.name}`

    const logger = {
      info: core.info,
      warn: core.warning
    }

    const entryPointUrl = await deploy({
      deployServiceHost,
      workspaceId,
      workspaceKey,
      pathToProject,
      pathToConfig,
      pathToEnvFile,
      secrets,
      variables: envVariables,
      label,
      githubMetadata,
      logger
    })

    if (isPullRequest) {
      const commitHash = githubMetadata.commit.sha
      const commitUrl = githubMetadata.repository.url + '/commit/' + commitHash
      const platformaticComment = createPlatformaticComment(entryPointUrl, commitHash, commitUrl)

      const lastCommentId = await findLastPlatformaticComment(octokit)
      /* istanbul ignore next */
      if (lastCommentId === null) {
        await postPlatformaticComment(octokit, platformaticComment)
      } else {
        await updatePlatformaticComment(octokit, lastCommentId, platformaticComment)
      }
    }

    core.setOutput('platformatic_app_url', entryPointUrl)
  } catch (error) {
    core.setFailed(error.message)
  }
}

module.exports = run
