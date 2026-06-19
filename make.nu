def main [msg: string] {
  rm dist\d365-toolkit.js
  npm run build
  git add .
  git commit -m $msg
  git push
}
