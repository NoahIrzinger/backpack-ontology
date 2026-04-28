import { ParsedArgs } from "../parser.js";
const COMMANDS = [
    "help", "version", "doctor",
    "login", "logout", "whoami",
    "where", "use",
    "ls", "cat", "show", "open", "search", "rm", "mv",
    "graphs", "graph", "containers", "container", "kbs", "kb",
    "init", "completion",
];
export async function runCompletion(args: ParsedArgs): Promise<number> {
    const shell = args.positional[0];
    if (!shell) {
        process.stderr.write(`bp completion: shell required.\nusage: bp completion <bash|zsh|fish>\n`);
        return 1;
    }
    switch (shell) {
        case "bash":
            process.stdout.write(bashScript() + "\n");
            return 0;
        case "zsh":
            process.stdout.write(zshScript() + "\n");
            return 0;
        case "fish":
            process.stdout.write(fishScript() + "\n");
            return 0;
        default:
            process.stderr.write(`bp completion: unknown shell "${shell}". try bash, zsh, or fish.\n`);
            return 1;
    }
}
function bashScript(): string {
    return `# bp bash completion. install with:
#   bp completion bash > ~/.local/share/bash-completion/completions/bp
# or source the output directly from your bashrc.

_bp_local_backpacks() {
  # Parse the JSON registry without requiring jq. The shape is
  #   { "paths": ["/abs/path1", "/abs/path2"], ... }
  # so we grep the array, split on quoted strings, and emit basenames.
  local f="\${XDG_CONFIG_HOME:-\$HOME/.config}/backpack/backpacks.json"
  [ -f "\$f" ] || return
  local arr
  arr=\$(tr -d '\\n' < "\$f" | grep -oE '"paths"[[:space:]]*:[[:space:]]*\\[[^]]*\\]')
  echo "\$arr" | grep -oE '"[^"]+"' | sed 's/^"//; s/"$//' | while read -r p; do
    [ -n "\$p" ] && echo "local:\$(basename "\$p")"
  done
}

_bp_completions() {
  local cur prev cmds
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmds="${COMMANDS.join(" ")}"
  if [ "\$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( \$(compgen -W "\$cmds" -- "\$cur") )
    return 0
  fi
  case "\$prev" in
    graphs|graph)
      COMPREPLY=( \$(compgen -W "list get describe create delete rename apply edit move" -- "\$cur") )
      return 0
      ;;
    kbs|kb)
      COMPREPLY=( \$(compgen -W "list get create edit delete move" -- "\$cur") )
      return 0
      ;;
    containers|container)
      COMPREPLY=( \$(compgen -W "list create rename delete" -- "\$cur") )
      return 0
      ;;
    completion)
      COMPREPLY=( \$(compgen -W "bash zsh fish" -- "\$cur") )
      return 0
      ;;
    use)
      local backpacks
      backpacks=\$(_bp_local_backpacks)
      COMPREPLY=( \$(compgen -W "\$backpacks" -- "\$cur") )
      return 0
      ;;
  esac
}
complete -F _bp_completions bp
`;
}
function zshScript(): string {
    return `#compdef bp
# bp zsh completion. install with one of:
#   bp completion zsh > "\${fpath[1]}/_bp"
#   bp completion zsh > ~/.zsh/completions/_bp
# then ensure ~/.zsh/completions is on fpath BEFORE compinit runs in your zshrc.

_bp_local_backpacks() {
  local f="\${XDG_CONFIG_HOME:-\$HOME/.config}/backpack/backpacks.json"
  [[ -f "\$f" ]] || return
  local arr
  arr="\$(tr -d '\\n' < "\$f" | grep -oE '"paths"[[:space:]]*:[[:space:]]*\\[[^]]*\\]')"
  echo "\$arr" | grep -oE '"[^"]+"' | sed 's/^"//; s/"$//' | while read -r p; do
    [[ -n "\$p" ]] && echo "local:\${p##*/}"
  done
}

_bp() {
  local -a commands
  commands=(${COMMANDS.map((c) => `'${c}:bp ${c}'`).join(" ")})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi
  case "\${words[2]}" in
    graphs|graph)
      _values 'verb' list get describe create delete rename apply edit move
      ;;
    kbs|kb)
      _values 'verb' list get create edit delete move
      ;;
    containers|container)
      _values 'verb' list create rename delete
      ;;
    completion)
      _values 'shell' bash zsh fish
      ;;
    use)
      local -a contexts
      contexts=("\${(@f)$(_bp_local_backpacks)}")
      _describe 'context' contexts
      ;;
  esac
}

_bp "$@"
`;
}
function fishScript(): string {
    return `# bp fish completion. install with:
#   bp completion fish > ~/.config/fish/completions/bp.fish

function __bp_local_backpacks
  set -l f "$XDG_CONFIG_HOME"
  test -z "$f"; and set f "$HOME/.config"
  set f "$f/backpack/backpacks.json"
  test -f "$f"; or return
  set -l arr (tr -d '\\n' < "$f" | string match -r '"paths"\\s*:\\s*\\[[^]]*\\]')
  test -z "$arr"; and return
  echo $arr | string match -r -a '"[^"]+"' | string trim -c '"' | while read -l p
    test -n "$p"; and echo "local:"(basename $p)
  end
end

complete -c bp -f
${COMMANDS.map((c) => `complete -c bp -n '__fish_use_subcommand' -a '${c}'`).join("\n")}

complete -c bp -n '__fish_seen_subcommand_from graphs graph' -a 'list get describe create delete rename apply edit move'
complete -c bp -n '__fish_seen_subcommand_from kbs kb' -a 'list get create edit delete move'
complete -c bp -n '__fish_seen_subcommand_from containers container' -a 'list create rename delete'
complete -c bp -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'
complete -c bp -n '__fish_seen_subcommand_from use' -a '(__bp_local_backpacks)'
`;
}
