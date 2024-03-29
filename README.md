# GitHub Action to deploy a Platformatic app to Platformatic Cloud

Example usage:

```yml
name: Deploy Platformatic app to Platformatic cloud

on:
  pull_request:
    paths-ignore:
      - 'docs/**'
      - '**.md'
  workflow_dispatch:
    inputs:
      label:
        description: "Preview Label"
        required: true
        default: ""

jobs:
  build_and_deploy:
    permissions:
      contents: read
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - name: Checkout application project repository
        uses: actions/checkout@v3

      - name: Install app dependencies
        run: npm install --omit=dev

      - name: Deploy app
        id: deploy-app
        uses: platformatic/onestep@latest
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          platformatic_workspace_id: ${{ vars.PLATFORMATIC_WORKSPACE_ID }}
          platformatic_workspace_key: ${{ secrets.PLATFORMATIC_WORKSPACE_API_KEY }}
          platformatic_config_path: ./platformatic.db.json
          post_pr_comment: false
          variables: custom_variable1, custom_variable2
          secrets: custom_secret1
          label: ${{ github.event.inputs.label }}
        env:
          plt_custom_variable: test1
          custom_variable1: test2
          custom_variable2: test3
          custom_secret1: test5

      - name: Output deployed app URL
        run: echo '${{ steps.deploy-app.outputs.platformatic_app_url }}'
```

## Deploy app to the dynamic workspace and calculate the risk

Example usage:

```yml
name: Deploy Platformatic application to the cloud
on:
  pull_request:
    paths-ignore:
      - 'docs/**'
      - '**.md'
  workflow_dispatch:
    inputs:
      label:
        description: "Preview Label"
        required: true
        default: ""

jobs:
  build_and_deploy:
    permissions:
      contents: read
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - name: Checkout application project repository
        uses: actions/checkout@v3
      - name: npm install --omit=dev
        run: npm install --omit=dev
      - name: Deploy project
        id: deploy-project
        uses: platformatic/onestep@latest
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          platformatic_workspace_id: ${{ secrets.PLATFORMATIC_DYNAMIC_WORKSPACE_ID }}
          platformatic_workspace_key: ${{ secrets.PLATFORMATIC_DYNAMIC_WORKSPACE_API_KEY }}
          platformatic_config_path: ./platformatic.service.json
          label: ${{ github.event.inputs.label }}
    outputs:
      deployment_id: ${{ steps.deploy-project.outputs.deployment_id }}
  calculate_risk:
    permissions:
      contents: read
      pull-requests: write
    needs: build_and_deploy
    runs-on: ubuntu-latest
    steps:
      - name: Calculate risk
        uses: platformatic/onestep/actions/calculate-risk@latest
        if: github.event_name == 'pull_request'
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          platformatic_workspace_id: ${{ secrets.PLATFORMATIC_DYNAMIC_WORKSPACE_ID }}
          platformatic_workspace_key: ${{ secrets.PLATFORMATIC_DYNAMIC_WORKSPACE_API_KEY }}
          platformatic_deployment_id: ${{ needs.build_and_deploy.outputs.deployment_id }}
```

## Monorepo/Subdirectory support

Use the [`jobs.<job_id>.defaults.run.working-directory`](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#defaultsrun) to specify the subdirectory of the project to deploy, this will ensure that all commands are run from the correct directory.

```yml
jobs:
  build_and_deploy:
    defaults:
      run:
        working-directory: <subdirectory>
```


## Developing

If you want to test your changes in any other env than the production one, you
should specify two things:

1. Action tag. You can use your feature branch name. Example: `platformatic/onestep@my-feature-branch`
2. `DEPLOY_SERVICE_HOST` env variable. Set it to the host of the service you want to deploy to.

__Example:__

```yml
name: Deploy Platformatic app to Platformatic cloud

on:
  pull_request:
    paths-ignore:
      - 'docs/**'
      - '**.md'
  workflow_dispatch:
    inputs:
      label:
        description: "Preview Label"
        required: true
        default: ""

jobs:
  build_and_deploy:
    permissions:
      contents: read
      pull-requests: write
    runs-on: ubuntu-latest
    steps:
      - name: Checkout application project repository
        uses: actions/checkout@v3

      - name: Install app dependencies
        run: npm install --omit=dev

      - name: Deploy app
        id: deploy-app
        uses: platformatic/onestep@my-feature-branch
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          platformatic_workspace_id: ${{ vars.PLATFORMATIC_WORKSPACE_ID }}
          platformatic_workspace_key: ${{ secrets.PLATFORMATIC_WORKSPACE_API_KEY }}
          platformatic_config_path: ./platformatic.db.json
          post_pr_comment: false
          variables: custom_variable1, custom_variable2
          secrets: custom_secret1
          label: ${{ github.event.inputs.label }}
        env:
          deploy_service_host: https://development.com
          plt_custom_variable: test1
          custom_variable1: test2
          custom_variable2: test3
          custom_secret1: test5

      - name: Output deployed app URL
        run: echo '${{ steps.deploy-app.outputs.platformatic_app_url }}'
```
