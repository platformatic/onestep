# deployer-action

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
    runs-on: ubuntu-latest
    steps:
      - name: Checkout application project repository
        uses: actions/checkout@v3
      - name: npm ci and test
        run: |
          npm ci
          npm test
      - name: Cloning platformatic/deployer-action
        uses: actions/checkout@v3
        with:
          repository: platformatic/deployer-action
          ref: refs/heads/main
          token: ${{ secrets.PLATFORMATIC_ACCESS_TOKEN }}
          persist-credentials: false
          path: ./.github/deployer-action
      - name: Deploy project
        id: deploy
        uses: ./.github/deployer-action
        with:
          platformatic-api-key: ${{ secrets.PLATFORMATIC_API_KEY }}
      - name: Comment PR
        uses: thollander/actions-comment-pull-request@v1
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          message: |
            **Your application was successfully deployed!** :rocket:
            Application url: ${{ steps.deploy.outputs.platformatic-app-url }}
```
