# GitHub Action to deploy a Platformatic app to Platformatic Cloud

Example usage:

```yml
name: Deploy Platformatic app to Platformatic cloud

on:
  pull_request:
    paths-ignore:
      - 'docs/**'
      - '**.md'

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
        uses: platformatic/onestep@v1.1.0
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          platformatic_workspace_id: <PLATFORMATIC_WORKSPACE_ID>
          platformatic_workspace_key: ${{ secrets.PLATFORMATIC_WORKSPACE_API_KEY }}
          platformatic_config_path: ./platformatic.db.json
          post_pr_comment: false
          variables: custom_variable1, custom_variable2
          secrets: custom_secret1
        env:
          plt_custom_variable: test1
          custom_variable1: test2
          custom_variable2: test3
          custom_secret1: test5

      - name: Output deployed app URL
        run: echo '${{ steps.deploy-app.outputs.platformatic_app_url }}'
```
