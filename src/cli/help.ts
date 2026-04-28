import { bold, dim, cyan } from "./colors.js";
export function printHint(): void {
    const lines = [
        bold("bp") + dim(" — Backpack CLI"),
        "",
        `  ${cyan("bp ls")}                    list graphs in the current backpack`,
        `  ${cyan("bp cat")} <name>            print a graph as JSON (pipe to jq)`,
        `  ${cyan("bp show")} <name>           human-friendly summary`,
        `  ${cyan("bp where")}                 show current scope`,
        `  ${cyan("bp doctor")}                check auth + connectivity`,
        "",
        dim(`  try \`bp help\` for everything`),
    ];
    process.stdout.write(lines.join("\n") + "\n");
}
const FULL_HELP_SECTIONS: {
    title: string;
    commands: [
        string,
        string
    ][];
}[] = [
    {
        title: "Common",
        commands: [
            ["bp ls [resource]", "list graphs / containers / kbs in the current scope"],
            ["bp cat <name>", "print a graph as JSON (pipe to jq, sed, etc.)"],
            ["bp show <name>", "human-friendly summary + type histogram"],
            ["bp open <name>", "open the graph in the local viewer"],
            ["bp search <query>", "full-text search across graph properties"],
            ["bp rm <name>", "shortcut for `bp graphs delete`"],
            ["bp mv <old> <new>", "shortcut for `bp graphs rename`"],
        ],
    },
    {
        title: "Auth & scope",
        commands: [
            ["bp login", "sign in to backpack-app via the browser"],
            ["bp logout", "sign out everywhere"],
            ["bp whoami", "show signed-in identity"],
            ["bp where", "show current scope (backpack / container / identity)"],
            ["bp use <name>", "switch context (local backpack or cloud container)"],
            ["bp use", "list available contexts"],
        ],
    },
    {
        title: "Graphs",
        commands: [
            ["bp graphs list", "list graphs in the current scope"],
            ["bp graphs get <name>", "print as JSON (pipeable)"],
            ["bp graphs describe <name>", "human summary"],
            ["bp graphs create <name> [--description=…]", "new empty graph"],
            ["bp graphs create <name> --from-file <f>", "create from a JSON file"],
            ["bp graphs apply -f <file>", "upsert from a JSON file"],
            ["bp graphs edit <name>", "open in $EDITOR, save back atomically"],
            ["bp graphs rename <old> <new>", "rename in place"],
            ["bp graphs delete <name>", "delete with confirm (or -y)"],
            ["bp graphs move <name> --to <container>", "relocate between cloud containers"],
        ],
    },
    {
        title: "KB documents",
        commands: [
            ["bp kbs list", "list KB docs in the current scope"],
            ["bp kbs get <id>", "print body (pipeable)"],
            ["bp kbs create -f <file.md>", "create from a markdown file"],
            ["bp kbs create --title=… --content=…", "create from flags"],
            ["bp kbs edit <id>", "edit body in $EDITOR"],
            ["bp kbs delete <id>", "delete with confirm"],
            ["bp kbs move <id> --to <container>", "relocate between cloud containers"],
        ],
    },
    {
        title: "Cloud containers",
        commands: [
            ["bp containers list", "list your cloud sync_backpacks"],
            ["bp containers create <name> [--color=#xxx] [--tags=a,b]", "new cloud container"],
            ["bp containers rename <old> <new>", "rename / recolor / retag"],
            ["bp containers delete <name>", "delete (refuses if non-empty)"],
        ],
    },
    {
        title: "Project setup",
        commands: [
            ["bp init [path]", "initialize a new local backpack root in CWD (or path)"],
            ["bp completion <shell>", "print shell-completion script (bash | zsh | fish)"],
        ],
    },
    {
        title: "Diagnostics",
        commands: [
            ["bp doctor", "auth, connectivity, version skew checks"],
            ["bp version", "print version"],
        ],
    },
];
const GLOBAL_FLAGS: [
    string,
    string
][] = [
    ["--json", "machine-readable JSON (the stable contract)"],
    ["--yaml", "machine-readable YAML"],
    ["--names", "names only, one per line"],
    ["--wide", "show extra columns"],
    ["--no-color", "disable ANSI colors"],
    ["-y, --yes", "skip confirmation on destructive ops"],
    ["-h, --help", "help for any command"],
];
export function printFullHelp(): void {
    const lines: string[] = [bold("bp") + dim(" — the Backpack CLI"), ""];
    for (const section of FULL_HELP_SECTIONS) {
        lines.push(bold(section.title));
        for (const [cmd, desc] of section.commands) {
            lines.push(`  ${padRight(cmd, 40)}  ${dim(desc)}`);
        }
        lines.push("");
    }
    lines.push(bold("Global flags"));
    for (const [f, d] of GLOBAL_FLAGS) {
        lines.push(`  ${padRight(f, 40)}  ${dim(d)}`);
    }
    process.stdout.write(lines.join("\n") + "\n");
}
function padRight(s: string, width: number): string {
    return s.length >= width ? s : s + " ".repeat(width - s.length);
}
