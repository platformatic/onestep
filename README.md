# Github action to deploy Platformatic DB application to the cloud

Example of usage:

```yml
name: Deploy Platformatic DB application to the cloud

on:
  pull_request:
    paths-ignore:
      - "docs/**"
      - "**.md"

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
        uses: platformatic/onestep@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          platformatic_workspace_id: df8d6d16-7cf3-448f-a192-c14daaaf98da
          platformatic_workspace_key: ${{ secrets.PLATFORMATIC_WORKSPACE_KEY }}
          platformatic_config_path: ./platformatic.db.json
          variables: custom_variable1, custom_variable2
          secrets: custom_secret1
        env:
          plt_custom_variable: test1
          custom_variable1: test2
          custom_variable2: test3
          custom_secret1: test5
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
