def main [msg: string] {
  npm run build
  git add .
  git commit -m $msg
  git push
}
