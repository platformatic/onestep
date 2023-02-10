# Github action to deploy Platformatic DB application to the cloud

Example of usage:

```yml
name: Deploy Platformatic DB application to the cloud

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
      - name: npm install --omit=dev
        run: npm install --omit=dev
      - name: Deploy project
        uses: platformatic/onestep@latest
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          platformatic_api_key: ${{ secrets.PLATFORMATIC_API_KEY }}
          platformatic_config_path: ./platformatic.db.json
          allowed_env_vars: custom_variable1, custom_variable2
        env:
          plt_custom_variable: test1
          custom_variable1: test2
          custom_variable2: test3
```
