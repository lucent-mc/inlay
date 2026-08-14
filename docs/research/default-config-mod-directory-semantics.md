# Default-config mod directory semantics

Research date: 2026-08-14

## Question

How do Configured Defaults, Config Manager, Your Options Shall Be Respected (YOSBR), and Default Options actually map author-supplied defaults to a Minecraft instance? Which paths are mirrors, which files receive special treatment, when are existing files replaced, and what can Inlay reliably use to detect each convention?

## Conclusion

The four mods cannot be represented by one undifferentiated “defaults directory mirrors `config/`” rule.

- **Configured Defaults**, **Config Manager**, and **YOSBR** use recursive game-root mirrors. Consequently their mappings for an ordinary runtime config are respectively `config/foo` ↔ `configureddefaults/config/foo`, `config/foo` ↔ `config/modpack_defaults/config/foo`, and `config/foo` ↔ `config/yosbr/config/foo`.
- **Default Options is a hybrid.** Only `config/defaultoptions/extra/**` is a game-root mirror. Files directly under `config/defaultoptions/` are handler inputs such as `options.txt`, `servers.dat`, and `keybindings.txt`, not a general mirrored tree.
- All four preserve an existing ordinary target during their automatic startup flow. Configured Defaults additionally merges only absent keys from its default `options.txt`; Config Manager has explicit update/reset modes that can overwrite targets or delete runtime configs; Default Options gives keybindings and resource-pack selection non-file-copy semantics.
- Directory existence alone is not a strong mod-detection signal for Configured Defaults, YOSBR, or Default Options because those mods create their own directory structure. It is useful as a convention signal, but Inlay should prefer a resolved Modrinth project ID or the mod ID inside JAR metadata, and should distinguish an empty/generated store from authored defaults.

The current Inlay runtime-config destinations are therefore structurally correct for ordinary files, including `config/defaultoptions/extra/config/**`. The incomplete part is treating each store as though that config projection describes all of the mod's behavior and detecting a store from directory existence alone.

## Compatibility matrix

| Mod | Defaults location | What mirrors the game root | Ordinary automatic startup behavior | Special behavior |
| --- | --- | --- | --- | --- |
| Configured Defaults | `configureddefaults/` | The whole directory, except generated/excluded entries | Recursively copies missing directories/files only | `configureddefaults/options.txt` is merged into root `options.txt` by option key on a client; existing keys win. Generated `README.md` and `.DS_Store` are excluded. |
| Config Manager | `config/modpack_defaults/` | The whole directory | Recursively copies missing directories/files only | Update overwrites every supplied target. Reset deletes everything in runtime `config/` except the defaults store, then overwrites supplied targets. It also preserves the Modrinth App fullscreen choice while handling `options.txt`. |
| YOSBR | `config/yosbr/` | The whole directory, using `config/yosbr/config/**` for runtime `config/**` and siblings for game-root paths | Recursively copies missing files only | It creates `config/yosbr/options.txt` and `config/yosbr/config/` itself. A nested `config/yosbr/config/yosbr/**` path is rejected to prevent self-copying. |
| Default Options | `config/defaultoptions/` | Only `config/defaultoptions/extra/**` | Extra files recursively copy to missing game-root targets only; registered simple targets also load only if absent | Flat named defaults, synthesized keybindings, plugin handlers, and one-time resource-pack selection have dedicated semantics. |

## Configured Defaults

### Layout and supported content

Configured Defaults calls `configureddefaults/` a synchronized mirror of `.minecraft`. It walks the whole tree, maps each descendant by its relative path to the game directory, and copies a directory or file only if the target does not exist.[^configured-source] This permits arbitrary game-root files and folders, not only `config/` files. The generated documentation gives these representative mappings:

```text
configureddefaults/options.txt        -> options.txt
configureddefaults/config/jei/jei.toml -> config/jei/jei.toml
```

The generated `configureddefaults/README.md` and `.DS_Store` are excluded from copying.[^configured-source]

For an ordinary config, the exact Inlay projection is:

```text
defaults: configureddefaults/config/<relative-to-config>
playable: config/<relative-to-config>
```

### `options.txt` merge

On the client, `configureddefaults/options.txt` is excluded from the ordinary copy pass. The mod first loads the playable `options.txt`, then inserts only keys absent there from the default file, splitting each line at the first colon. It rewrites playable `options.txt` only when new keys were added; existing user values win and malformed lines are skipped.[^configured-source] The loader passes this merge mode only in a client environment.[^configured-loader]

This is not a general structured merge for JSON, TOML, or other configs. Every other file remains missing-target-only.

### Detection

- Mod ID: `configureddefaults`.[^configured-id]
- Modrinth project ID: `SISoSFPP`.[^configured-project]
- Convention directory: `configureddefaults/`.

The mod creates `configureddefaults/` and its `README.md` if missing, so directory existence proves at most that the convention exists or the mod ran previously. A reliable positive mod match comes from the resolved project ID or JAR metadata. Authored-default detection should require content other than the generated `README.md`/`.DS_Store`.

The 1.20.1, 1.21.1, and 26.2 source branches inspected retain this same core layout in their current heads; links below pin the 1.21.1 implementation because that is the current test instance's Minecraft line.[^configured-branches] Version still matters: the 1.20.1 and 1.21.1 changelogs say key-level `options.txt` merging was introduced in `v8.0.2-1.20.1` and `v21.1.1-1.21.1`, respectively. Older artifacts on those Minecraft lines use ordinary missing-only copying for `options.txt`, and early merge releases were subsequently fixed to accept colons inside values.[^configured-changelog]

## Config Manager

### Layout and supported content

Config Manager documents `config/modpack_defaults/` as a mirror of the Minecraft game root, not of `config/` alone.[^manager-guide] The implementation recursively walks that directory and resolves each relative path against the game directory.[^manager-copy]

```text
config/modpack_defaults/options.txt       -> options.txt
config/modpack_defaults/config/myMod.json -> config/myMod.json
```

It imposes no file-type or top-level-directory allowlist; the project guide says non-config content technically works but is not recommended.[^manager-guide]

For an ordinary config, the exact Inlay projection is:

```text
defaults: config/modpack_defaults/config/<relative-to-config>
playable: config/<relative-to-config>
```

The canonical directory is plural, `modpack_defaults`. Some prose/examples in older documentation use the singular `modpack_default`; the constant and copy implementation on all three maintained source lines use the plural spelling.[^manager-constant]

### Copy, update, and reset

The normal startup copy skips every target that already exists.[^manager-copy] Two flags directly under runtime `config/` change the next startup:

- `config/CONFIG_MANAGER_UPDATE_FLAG` recursively copies the defaults mirror with `REPLACE_EXISTING`, but does not remove unrelated files.[^manager-startup][^manager-update]
- `config/CONFIG_MANAGER_RESET_FLAG` recursively deletes every direct child of runtime `config/` except `modpack_defaults`, then runs the overwriting copy. Defaults aimed outside runtime `config/` are overwritten but not first deleted.[^manager-startup][^manager-reset]

When the Modrinth App has already generated root `options.txt` to carry its fullscreen preference, the normal copy path temporarily removes that file, applies the pack default, then reapplies the launcher's fullscreen value.[^manager-modrinth]

### Detection

- Mod ID: `config_manager`.[^manager-id]
- Modrinth project ID: `jlNms3Jp`.[^manager-project]
- Convention directory: `config/modpack_defaults/`.

Unlike the other three implementations, the normal copy code does not create the defaults directory. Its existence is therefore a stronger authored-convention signal, although project/JAR identity remains the reliable mod-presence test. The two flag files are commands/runtime state, not authorable defaults and should never be projected into the defaults tree.

## Your Options Shall Be Respected (YOSBR)

### Layout and supported content

YOSBR recursively walks every regular file below `config/yosbr/`. Its official project description demonstrates both the root and config mappings:[^yosbr-project]

```text
config/yosbr/options.txt                              -> options.txt
config/yosbr/config/roughlyenoughitems/config.json5  -> config/roughlyenoughitems/config.json5
```

The source derives targets relative to `config/yosbr/config/`: descendants of that directory remain below runtime `config/`, while sibling paths such as `config/yosbr/options.txt` resolve one level upward to the game root.[^yosbr-source] Thus `config/yosbr/` is a full game-root mirror, although its placement makes the `config/**` case look special.

For an ordinary config, the exact Inlay projection is:

```text
defaults: config/yosbr/config/<relative-to-config>
playable: config/<relative-to-config>
```

Every target is copied only if absent; existing targets are never updated or merged.[^yosbr-source] The implementation rejects `config/yosbr/config/yosbr/**`, which would target the defaults tree itself.[^yosbr-source]

### Detection

- Mod ID: `yosbr`.[^yosbr-metadata]
- Modrinth project ID: `WwbubTsV`.[^yosbr-project]
- Convention directory: `config/yosbr/`.

YOSBR creates the directory, an empty `options.txt`, and the nested `config/` directory on startup.[^yosbr-source] Directory existence—or even the generated zero-byte `options.txt`—does not establish that meaningful defaults are authored. Prefer project/JAR identity, and regard nonempty regular files beyond the generated skeleton as the authored-default signal.

## Default Options

### The store is not one mirror

Default Options creates `config/defaultoptions/`, but files directly inside it are inputs to named handlers rather than arbitrary root-relative paths.[^default-context] Its built-in handlers currently register:

| Defaults input | Runtime effect |
| --- | --- |
| `config/defaultoptions/options.txt` | Creates root `options.txt` only if absent, while excluding `key_` lines during save/load. |
| `config/defaultoptions/servers.dat` | Creates root `servers.dat` only if absent. |
| `config/defaultoptions/optionsof.txt` | Creates root OptiFine `optionsof.txt` only if absent. |
| `config/defaultoptions/optionsviveprofiles.txt` | Creates root Vivecraft `optionsviveprofiles.txt` only if absent. |
| `config/defaultoptions/keybindings.txt` | Parsed as a custom keybinding-default format; it is not copied to a corresponding runtime file. |
| Default Options' own config | Stores default resource-pack repository IDs; those are applied once and recorded in root `defaultoptions.journal.json`. |

The registered filenames come from the built-in handler list.[^default-builtins] Simple file handlers use only the registered target's basename for the defaults input and load only if the runtime target is absent.[^default-simple] The keybinding handler instead updates each key's default and changes the current key only while it remains at the mod's original default, preserving keys the user has already changed.[^default-keys] Resource-pack selection is applied once, with the journal preventing another application; official documentation explicitly says not to package that journal.[^default-resources]

Other mods can register additional files or arbitrary handlers through the public plugin API, so the built-in list is not exhaustive for every installed combination.[^default-api]

### `extra/` is the actual mirror

`config/defaultoptions/extra/**` is recursively walked and mapped relative to `extra/` into the game root. Only regular files are copied, and only where the target does not exist.[^default-extra]

```text
config/defaultoptions/extra/config/foo.json -> config/foo.json
config/defaultoptions/extra/journeymap/**    -> journeymap/**
```

The save command does not populate `extra/`; pack authors must put desired files there manually.[^default-readme] Therefore Inlay's ordinary-config projection is:

```text
defaults: config/defaultoptions/extra/config/<relative-to-config>
playable: config/<relative-to-config>
```

That projection is correct, but it must not be generalized to direct children such as `keybindings.txt` or `options.txt`.

### Detection

- Mod ID: `defaultoptions`.[^default-id]
- Modrinth project ID: `WEg59z5b`.[^default-project]
- Convention directory: `config/defaultoptions/`.

The mod creates `config/defaultoptions/`, and its extra handler creates `extra/`, so those directories alone are weak presence/authorship signals.[^default-context][^default-extra] Reliable mod detection should use project/JAR identity. Authored-default detection can use a nonempty `extra/`, recognized built-in handler inputs, or installed plugin knowledge; Default Options' own live config may also carry a resource-pack default without any mirrored file.

## Resulting Inlay policy

1. Model these as four named adapters, not one `{ root, configRoot }` table whose fields imply complete semantics.
2. Keep the four ordinary runtime-config projections shown above. They are valid destinations for `config/**` files.
3. Detect the installed mod primarily from the resolved manifest entry's Modrinth project ID or JAR metadata mod ID. Use directory existence only as a fallback convention hint and surface ambiguity when multiple adapters appear present.
4. Never treat generated/store-control files as pack defaults: Configured Defaults' generated `README.md`, Config Manager's update/reset flags, YOSBR's generated empty skeleton, and Default Options' root `defaultoptions.journal.json`.
5. Status should understand non-config mappings too. At minimum, it must not claim root `options.txt`, keybindings, or resource-pack state is represented by the generic `config/**` diff.
6. Because behavior is versioned code, retain the detected project/version alongside an adapter choice. Unknown forks or future major versions should fall back to ordinary file tracking or an explicit user-selected mapping instead of silently assuming one of these semantics.

## Sources

[^configured-source]: Configured Defaults, [`CopyDefaultsHandler` for Minecraft 1.21.1 at `35e17a2`](https://github.com/Fuzss/configured-defaults/blob/35e17a230a02ea3d86e021a963f658cbb963cb8a/Fabric/src/main/java/fuzs/configureddefaults/handler/CopyDefaultsHandler.java#L14-L157).
[^configured-loader]: Configured Defaults, [Fabric language adapter selecting client merge behavior at `35e17a2`](https://github.com/Fuzss/configured-defaults/blob/35e17a230a02ea3d86e021a963f658cbb963cb8a/Fabric/src/main/java/fuzs/configureddefaults/fabric/ConfiguredDefaultsLanguageAdapter.java#L12-L18).
[^configured-id]: Configured Defaults, [mod identity constants at `35e17a2`](https://github.com/Fuzss/configured-defaults/blob/35e17a230a02ea3d86e021a963f658cbb963cb8a/Fabric/src/main/java/fuzs/configureddefaults/ConfiguredDefaults.java#L6-L10).
[^configured-project]: Modrinth API, [Configured Defaults project `SISoSFPP`](https://api.modrinth.com/v2/project/SISoSFPP).
[^configured-branches]: Configured Defaults source branches pinned for [1.20.1 (`202cb21`)](https://github.com/Fuzss/configured-defaults/tree/202cb2144a7daefd7f0ec370d7c8df80c86c4df6), [1.21.1 (`35e17a2`)](https://github.com/Fuzss/configured-defaults/tree/35e17a230a02ea3d86e021a963f658cbb963cb8a), and [26.2 (`de54785`)](https://github.com/Fuzss/configured-defaults/tree/de54785063cb34a825b424277e08dc823059a5b9).
[^configured-changelog]: Configured Defaults, [1.20.1 changelog at `202cb21`](https://github.com/Fuzss/configured-defaults/blob/202cb2144a7daefd7f0ec370d7c8df80c86c4df6/CHANGELOG.md#L6-L18) and [1.21.1 changelog at `35e17a2`](https://github.com/Fuzss/configured-defaults/blob/35e17a230a02ea3d86e021a963f658cbb963cb8a/CHANGELOG.md#L7-L19).
[^manager-guide]: Config Manager, [official modpack guide at `3a6629f`](https://github.com/TheBossMagnus/Config-Manager/blob/3a6629f82248ce540cd766842f69d0a3da49c7b5/MODPACK_GUIDE.md#L1-L40).
[^manager-copy]: Config Manager, [missing-only recursive copy at `3a6629f`](https://github.com/TheBossMagnus/Config-Manager/blob/3a6629f82248ce540cd766842f69d0a3da49c7b5/common/src/main/java/io/github/thebossmagnus/mods/config_manager/common_coremod/CopyConfig.java#L13-L66).
[^manager-constant]: Config Manager, [canonical `modpack_defaults` constant at `3a6629f`](https://github.com/TheBossMagnus/Config-Manager/blob/3a6629f82248ce540cd766842f69d0a3da49c7b5/common/src/main/java/io/github/thebossmagnus/mods/config_manager/common_coremod/Constants.java#L5-L10).
[^manager-startup]: Config Manager, [flag dispatch at `3a6629f`](https://github.com/TheBossMagnus/Config-Manager/blob/3a6629f82248ce540cd766842f69d0a3da49c7b5/common/src/main/java/io/github/thebossmagnus/mods/config_manager/common_coremod/ConfigManagerStartup.java#L10-L38).
[^manager-update]: Config Manager, [overwriting update copy at `3a6629f`](https://github.com/TheBossMagnus/Config-Manager/blob/3a6629f82248ce540cd766842f69d0a3da49c7b5/common/src/main/java/io/github/thebossmagnus/mods/config_manager/common_coremod/OverwriteConfig.java#L10-L41).
[^manager-reset]: Config Manager, [reset/delete semantics at `3a6629f`](https://github.com/TheBossMagnus/Config-Manager/blob/3a6629f82248ce540cd766842f69d0a3da49c7b5/common/src/main/java/io/github/thebossmagnus/mods/config_manager/common_coremod/ResetAndCopyConfig.java#L10-L48).
[^manager-modrinth]: Config Manager, [Modrinth App fullscreen compatibility at `3a6629f`](https://github.com/TheBossMagnus/Config-Manager/blob/3a6629f82248ce540cd766842f69d0a3da49c7b5/common/src/main/java/io/github/thebossmagnus/mods/config_manager/common_coremod/compat/ModrinthAppCompat.java#L13-L73).
[^manager-id]: Config Manager, [mod ID property at `3a6629f`](https://github.com/TheBossMagnus/Config-Manager/blob/3a6629f82248ce540cd766842f69d0a3da49c7b5/gradle.properties#L10-L13).
[^manager-project]: Modrinth API, [Config Manager project `jlNms3Jp`](https://api.modrinth.com/v2/project/jlNms3Jp).
[^yosbr-project]: Modrinth API, [YOSBR project `WwbubTsV` and official description](https://api.modrinth.com/v2/project/WwbubTsV).
[^yosbr-source]: YOSBR, [directory setup, target mapping, and missing-only copy at `6ede5aa`](https://github.com/shedaniel/your-options-shall-be-respected/blob/6ede5aa418f23a6601a8a6de3ceeb145b266c082/src/main/java/me/shedaniel/yosbr/YourOptionsShallBeRespected.java#L16-L75).
[^yosbr-metadata]: YOSBR, [Fabric metadata at `6ede5aa`](https://github.com/shedaniel/your-options-shall-be-respected/blob/6ede5aa418f23a6601a8a6de3ceeb145b266c082/src/main/resources/fabric.mod.json#L1-L19).
[^default-context]: Default Options, [defaults directory construction at `3682d93`](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/common/src/main/java/net/blay09/mods/defaultoptions/DefaultOptionsContext.java#L5-L29).
[^default-builtins]: Default Options, [built-in handler registrations at `3682d93`](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/common/src/main/java/net/blay09/mods/defaultoptions/DefaultOptionsDefaultHandlers.java#L12-L31).
[^default-simple]: Default Options, [simple registered-file mapping and missing-only load at `3682d93`](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/common/src/main/java/net/blay09/mods/defaultoptions/SimpleDefaultOptionsFileHandler.java#L20-L96).
[^default-keys]: Default Options, [keybinding handler at `3682d93`](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/common/src/main/java/net/blay09/mods/defaultoptions/keys/KeyMappingDefaultsHandler.java#L24-L154).
[^default-resources]: Default Options, [resource-pack handler at `3682d93`](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/common/src/main/java/net/blay09/mods/defaultoptions/resources/DefaultResourcePacksHandler.java#L19-L93) and [official journal warning](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/README.md#L32-L37).
[^default-api]: Default Options, [official plugin API documentation at `3682d93`](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/README.md#L61-L94).
[^default-extra]: Default Options, [`extra/**` mirror implementation at `3682d93`](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/common/src/main/java/net/blay09/mods/defaultoptions/ExtraDefaultOptionsHandler.java#L14-L82).
[^default-readme]: Default Options, [official extra-defaults documentation at `3682d93`](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/README.md#L39-L59).
[^default-id]: Default Options, [mod ID property at `3682d93`](https://github.com/TwelveIterationMods/DefaultOptions/blob/3682d9368813a4ac870f6a257fd154fbc330dd34/gradle.properties#L1-L4).
[^default-project]: Modrinth API, [Default Options project `WEg59z5b`](https://api.modrinth.com/v2/project/WEg59z5b).
