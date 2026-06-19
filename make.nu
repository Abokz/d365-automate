def main [msg: string] {
  rm dist\d365-toolkit.js
  node build.js
  git add .
  git commit -m $msg
  git push
}
