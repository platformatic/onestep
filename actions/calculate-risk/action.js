'use strict'

const core = require('@actions/core')
const github = require('@actions/github')
const { request } = require('undici')

const PROD_DEPLOY_SERVICE_HOST = 'https://plt-production-deploy-service.fly.dev'

async function postPlatformaticComment (octokit, comment) {
  const context = github.context.payload

  await octokit.rest.issues.createComment({
    owner: context.repository.owner.login,
    repo: context.repository.name,
    issue_number: context.pull_request.number,
    body: comment
  })
}

async function calculateDeploymentRisks (
  deployServiceHost,
  workspaceId,
  workspaceKey,
  deploymentId
) {
  const url = deployServiceHost + `/deployments/${deploymentId}/risks`
  const { statusCode, body } = await request(url, {
    method: 'GET',
    headers: {
      'x-platformatic-workspace-id': workspaceId,
      'x-platformatic-api-key': workspaceKey
    },
    headersTimeout: 60 * 1000
  })

  if (statusCode !== 200) {
    const error = await body.text()
    throw new Error(`Failed to calculate deployment risks: ${error}`)
  }

  return body.json()
}

function generateRisksComment (risks) {
  let comment = ''
  for (const workspaceRisks of risks) {
    const { workspaceName, overallRisk, services, openAPI, graphQL } = workspaceRisks

    const riskPercentage = (overallRisk * 100).toFixed(2)
    comment += `## The risk of deploying to the \`${workspaceName}\` workspace is ${riskPercentage}%!\n\n`

    // To support the old version of the core risk management, which returns `services` instead of `openAPI`
    const openAPIServices = openAPI?.services || services

    for (const service of openAPIServices) {
      comment += `<h3>OpenAPI Changes for the \`${service.telemetryName}\` service</h3> \n\n`

      for (const operation of service.operations) {
        const operationDetails = operation.operation
        const changesType = operation?.changes?.type

        const operationChangeTitle = generateOperationChangeTitle(operationDetails, changesType)

        comment += '<details>\n'
        comment += `<summary>${operationChangeTitle}</summary>\n\n`

        comment += generateTracesImpactedComment(operation.tracesImpacted)
        comment += generateOperationChangesComment(operation.changes)
        comment += '</details>\n\n'
      }
    }

    if (graphQL) {
      const { services: graphQLServices } = graphQL
      for (const service of graphQLServices) {
        comment += `<h3>GraphQL Changes for the \`${service.telemetryName}\` service </h3>\n\n`

        // In GraphQL we have to list all the changes first, because we don't have the concept of "operations"
        // i.e. is we change a type, all the queries and mutations that use that type will be impacted
        comment += generateGraphQLSchemaDiff(service.diff)

        comment += '### GraphQL Operations impacted by the changes:\n\n'
        const queries = service.operations.filter(operation => operation.operation.method === 'QUERY')
        const mutations = service.operations.filter(operation => operation.operation.method === 'MUTATION')
        for (const query of queries.concat(mutations)) {
          console.log('@@@@@@@@@2', JSON.stringify(query, null, 2))
          const queryDetails = query.operation
          const tracesImpacted = query.tracesImpacted
          // const path = queryDetails.path
          // const method = queryDetails.method

          const graphQLOperationChangeTitle = generateGraphQLOperationChangeTitle(queryDetails)

          comment += '<details>\n'

          comment += `<summary>${graphQLOperationChangeTitle}</summary>\n\n`
          if (tracesImpacted && tracesImpacted.length !== 0) {
            comment += generateTracesImpactedComment(tracesImpacted)
            comment += generateGraphQLSchemaChanges(query.changes)
            // comment += `GraphQL path \`${path}\`\n\n`
          }
          comment += '</details>\n\n'
        }
      }
    }
  }

  return comment
}

function generateOperationChangeTitle (operationDetails, changesType) {
  const { protocol, method, path } = operationDetails

  if (protocol === 'http') {
    if (changesType === 'deletion') {
      return `<b>${method.toUpperCase()}</b> <code>${path}</code> route was deleted`
    }
    if (changesType === 'modification') {
      return `<b>${method.toUpperCase()}</b> <code>${path}</code> route was modified`
    }
    throw new Error(`Unsupported changes type: ${changesType}`)
  }
  throw new Error(`Unsupported operation protocol: ${protocol}`)
}

function generateGraphQLOperationChangeTitle (operationDetails) {
  const { protocol, method, path } = operationDetails
  if (method === 'QUERY') {
    return `<b>${method.toUpperCase()}</b> <code>${path}</code> query was modified`
  } else if (method === 'MUTATION') {
    return `<b>${method.toUpperCase()}</b> <code>${path}</code> mutation was modified`
  } else {
    throw new Error(`Unsupported method: ${method}`)
  }
}

function generateTracesImpactedComment (tracesImpacted) {
  let comment = ''

  if (tracesImpacted.length === 0) return comment

  comment += '#### Impacted operation traces:\n\n'
  comment += '```mermaid\ngraph LR;\n'

  let linesNumber = 0

  for (let i = 0; i < tracesImpacted.length; i++) {
    const impactedServiceOperations = tracesImpacted[i]
    comment += `START${i}[ ]`
    for (const impactedOperation of impactedServiceOperations) {
      const telemetryName = impactedOperation.telemetryName
      const { method, path } = impactedOperation.operation
      comment += `-- "${method} ${path}" --> ${telemetryName}(${telemetryName})`
    }
    comment += '\n'
    comment += `style START${i} fill:#FFFFFF00, stroke:#FFFFFF00\n`

    const color = getRandomColor()
    for (let j = 0; j < impactedServiceOperations.length; j++) {
      const impactedOperation = impactedServiceOperations[j]
      const telemetryName = impactedOperation.telemetryName

      comment += `style ${telemetryName} stroke:#21FA90,stroke-width:1px\n`
      comment += `linkStyle ${linesNumber++} stroke-width:2px,fill:none,stroke:${color}\n`
    }
  }
  comment += '```\n\n'

  return comment
}

function getRandomColor () {
  const letters = '0123456789ABCDEF'
  let color = '#'
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)]
  }
  return color
}

function generateOperationChangesComment (operationChanges) {
  let comment = ''

  const changesType = operationChanges.type

  if (changesType === 'deletion') {
    comment += '#### Removed route OpenApi schema:\n\n'
    comment += generateDiffComment(JSON.stringify(operationChanges.data, null, 2))
    return comment
  }

  if (changesType === 'modification') {
    comment += '#### OpenApi schema changes:\n\n'
    if (operationChanges.additions?.length > 0) {
      for (const addition of operationChanges.additions) {
        comment += `JSON path \`${addition.jsonPath}\`\n\n`
        comment += generateDiffComment(null, JSON.stringify(addition.value, null, 2))
      }
    }
    if (operationChanges.deletions?.length > 0) {
      for (const deletion of operationChanges.deletions) {
        comment += `JSON path \`${deletion.jsonPath}\`\n\n`
        comment += generateDiffComment(JSON.stringify(deletion.value, null, 2))
      }
    }
    if (operationChanges.modifications?.length > 0) {
      for (const modification of operationChanges.modifications) {
        comment += `JSON path \`${modification.jsonPath}\`\n\n`
        comment += generateDiffComment(
          JSON.stringify(modification.before, null, 2),
          JSON.stringify(modification.after, null, 2)
        )
      }
    }
    return comment
  }

  throw new Error(`Unsupported changes type: ${changesType}`)
}

function generateDiffComment (before, after) {
  const _before = before ? '-' + before.split('\n').join('\n-') + '\n' : ''
  const _after = after ? '+' + after.split('\n').join('\n+') + '\n' : ''
  return '```diff\n' + _before + _after + '```\n\n'
}

function generateGraphQLSchemaDiff (diff) {
  let comment = ''
  if (diff) {
    comment += '### GraphQL Schema changes:\n\n'
    comment += '```diff\n' + diff + '```\n\n'
  }
  return comment
}

function generateGraphQLSchemaChanges (changes) {
  let comment = ''
  console.log('@@@@@@@@@@@@@@@', changes)

  comment += '#### GraphQL schema changes:\n\n'
  for (const change of changes) {
    const message = change.message
    const path = change.path
    comment += `##### ${message}\n\n`
    comment += `path \`${path}\`\n\n`
  }

  return comment
}

async function run () {
  try {
    const eventName = process.env.GITHUB_EVENT_NAME
    if (eventName !== 'pull_request') {
      throw new Error('The action only works on pull_request events')
    }

    const workspaceId = core.getInput('platformatic_workspace_id')
    const workspaceKey = core.getInput('platformatic_workspace_key')
    const deploymentId = core.getInput('platformatic_deployment_id')

    const deployServiceHost = process.env.DEPLOY_SERVICE_HOST ||
      PROD_DEPLOY_SERVICE_HOST

    const githubToken = core.getInput('github_token')
    const octokit = github.getOctokit(githubToken)

    core.info('Calculating deployment risks')

    const risks = await calculateDeploymentRisks(
      deployServiceHost,
      workspaceId,
      workspaceKey,
      deploymentId
    )

    core.info('Deployment risks calculated')
    const message = generateRisksComment(risks)
    await postPlatformaticComment(octokit, message)
  } catch (error) {
    console.trace(error)
    core.setFailed(error.message)
  }
}

module.exports = run
