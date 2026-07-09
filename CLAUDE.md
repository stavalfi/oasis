## Approach

- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.

- never tell me something to check if you can check by your self and it's readonly call.
- dont give me tasks estimations unless i ask for it
- dont give me instructions and ask me questions unless you faield to find the answer yourself.
- NEVER edit files under `~/.claude/`. All claude config (skills, settings) lives in `.claude/` inside the project repo only.
- do not bring back code that i deleted
- NEVER guess!!!! always verify by real comand and output.
- NEVER run any commands on prod k8s env or any prod resoruces (DBs/pods/...)
- stop ask me if i want to do what i told u to do.
- to read env: use printenv <env name>, insetad of echo $env.
- unless i specificly asked you, dont add echo to commands, do parse them, use single line bash commands. if u need params like password, use $() inside the command. make it super simple and short as possible.
- never give me multiple solutions. just give me the best one based on what i asked.
- dont add 2>/dev/null to commands.
- never do `git checkout HEAD --` unless i confirm it
- don't prefix shell commands with `nix develop --command` or `direnv exec .` — direnv already activates the flake dev shell in the working dir, so tools like `bun`, `oxlint`, `oxfmt`, `node`, etc. are already on PATH. Just run them directly.
- run `npm run build` and `npm run lint` and `npm run format` after u finish a task/sub-task and fix all errors.
- when i ask yes/no question. always just answer yes/no. if i want more info - i will ask for it.
- always use descriptive names everywhere. (sid -> session_id)
