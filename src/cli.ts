#!/usr/bin/env node
import path from "node:path";
import * as p from "@clack/prompts";
import { Command } from "commander";
import pc from "picocolors";
import { buildPack, type PublicationTarget } from "./build/build.js";
import { ListTreePrompt } from "./cli/list-tree.js";
import { StatusTreePrompt } from "./cli/status-tree.js";
import { TOOLKIT_VERSION } from "./constants.js";
import { error, InlayError, result } from "./diagnostics.js";
import { readManifest } from "./manifest/index.js";
import { createChange, versionLayer } from "./operations/changes.js";
import { fetchLayer, pullLayer, switchLayer } from "./operations/collaborate.js";
import { commitStaged } from "./operations/commit.js";
import { generateDocs } from "./operations/docs.js";
import { forkLayer } from "./operations/fork.js";
import { initialize } from "./operations/init.js";
import { listPack, listView } from "./operations/list.js";
import { materialize } from "./operations/materialize.js";
import { migrateManifest } from "./operations/migrate.js";
import { addContent, removeContent } from "./operations/packages.js";
import { removeParent, setParent } from "./operations/parent.js";
import { type ReconcileAction, reconcileTarget, reconcileTargets } from "./operations/reconcile.js";
import { checkPack } from "./operations/resolve.js";
import { status } from "./operations/status.js";
import { discoverUpdates, updateContent } from "./operations/updates.js";
import type { CommandResult, Diagnostic, Environment } from "./types.js";

interface GlobalOptions {
  root: string;
  json?: boolean;
  interactive: boolean;
  dryRun?: boolean;
}

function globalOptions(command: Command): GlobalOptions {
  const options = command.optsWithGlobals() as {
    root: string;
    json?: boolean;
    interactive: boolean;
    dryRun?: boolean;
  };
  return { ...options, root: path.resolve(options.root) };
}

function renderDiagnostic(item: Diagnostic): string {
  const symbol =
    item.severity === "error" ? pc.red("×") : item.severity === "warning" ? pc.yellow("▲") : pc.cyan("i");
  const location = item.path ? pc.dim(` (${item.path})`) : "";
  return `${symbol} ${item.message}${location}${item.detail ? `\n  ${pc.dim(item.detail)}` : ""}`;
}

function emit<T>(value: CommandResult<T>, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  for (const diagnostic of value.diagnostics) console.log(renderDiagnostic(diagnostic));
  if (value.data !== undefined) console.log(pc.dim(JSON.stringify(value.data, null, 2)));
}

async function execute<T>(
  commandName: string,
  options: GlobalOptions,
  operation: () => Promise<{ data: T; diagnostics?: Diagnostic[]; changed?: boolean }>,
): Promise<void> {
  try {
    const outcome = await operation();
    const value = result(commandName, outcome.data, outcome.diagnostics ?? [], outcome.changed ?? false);
    emit(value, options.json === true);
    if (!value.ok) process.exitCode = 1;
  } catch (cause) {
    const failure =
      cause instanceof InlayError
        ? cause
        : new InlayError(error("internal-error", cause instanceof Error ? cause.message : String(cause)), 3);
    emit(result(commandName, {}, failure.diagnostics), options.json === true);
    process.exitCode = failure.exitCode;
  }
}

async function interactiveStatus(root: string): Promise<void> {
  while (true) {
    const report = await status(root);
    const intent = await new StatusTreePrompt(report.entries).prompt();
    if (p.isCancel(intent) || intent?.kind === "finish") break;
    if (!intent) continue;
    if (intent.kind === "inspect") {
      const selected = report.entries.filter((entry) => intent.paths.includes(entry.path));
      p.note(
        selected
          .map((entry) => `${entry.path}\n  ${entry.state} · ${entry.owner}\n  ${entry.detail}`)
          .join("\n\n"),
        "Provenance",
      );
      continue;
    }
    if (intent.target) await reconcileTarget(root, intent.target, { interactive: true });
    else await reconcileTargets(root, intent.paths, { interactive: true });
  }
  const { staged } = await import("./adapters/git.js").then(async ({ GitAdapter }) => {
    const git = new GitAdapter(root);
    return { staged: await git.staged() };
  });
  if (staged.length > 0) await commitStaged(root, { interactive: true });
}

const program = new Command()
  .name("lay")
  .description("Author, resolve, validate, and build layered Minecraft modpacks.")
  .version(TOOLKIT_VERSION)
  .option("--root <directory>", "Layer repository and playable instance root", process.cwd())
  .option("--json", "emit one machine-readable JSON result")
  .option("--no-interactive", "never prompt; unresolved choices fail")
  .option("--dry-run", "derive and validate a complete plan without writing");

program
  .command("init")
  .description("create a root Layer in the current playable instance")
  .option("--name <name>")
  .option("--layer-version <semver>", "initial Layer version", "0.1.0")
  .option("--minecraft <version>")
  .option("--loader <loader>")
  .option("--loader-version <version>")
  .action(async (local, command) => {
    const options = globalOptions(command);
    let initialized = false;
    await execute("init", options, async () => {
      const manifest = await initialize(options.root, {
        ...local,
        version: local.layerVersion,
        interactive: options.interactive,
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      });
      initialized = options.dryRun !== true;
      return { data: manifest, changed: initialized };
    });
    if (initialized && options.interactive && options.json !== true) await interactiveStatus(options.root);
  });

program
  .command("fork")
  .description("create and hydrate a child Layer")
  .argument("<source>", "GitHub repository, immutable manifest URL, or Modrinth pack source")
  .argument("[selector]", "full Git commit or Modrinth version ID")
  .requiredOption("--name <name>")
  .option("--filename <filename>")
  .option("--layer-version <semver>", "initial child Layer version", "0.1.0")
  .option("--environment <environment>", "client or server", "client")
  .action(async (source, selector, local, command) => {
    const options = globalOptions(command);
    let forked = false;
    await execute("fork", options, async () => {
      const data = await forkLayer(options.root, source, {
        version: selector,
        filename: local.filename,
        name: local.name,
        layerVersion: local.layerVersion,
        environment: local.environment as Environment,
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      });
      forked = options.dryRun !== true;
      return { data, changed: forked };
    });
    if (forked && options.interactive && options.json !== true) await interactiveStatus(options.root);
  });

program
  .command("check")
  .alias("validate")
  .description("validate the manifest, resolved lineage, payloads, and required dependency closure")
  .action(async (_local, command) => {
    const options = globalOptions(command);
    await execute("check", options, async () => {
      const checked = await checkPack(options.root);
      return {
        data: {
          lineage: checked.pack.lineage,
          files: checked.inventory.content.length,
          dependencies: checked.pack.dependencies,
        },
        diagnostics: checked.diagnostics,
      };
    });
  });

program
  .command("list")
  .description("show lineage-owned content or the effective resolved Pack")
  .option("--resolved", "show only effective content while retaining provenance")
  .option("--type <category>", "filter mods, resource packs, shader packs, data packs, configs, or other")
  .option("--layer <name>", "filter by owning Layer name or version")
  .action(async (local, command) => {
    const options = globalOptions(command);
    if (options.interactive && options.json !== true && options.dryRun !== true) {
      try {
        const checked = await checkPack(options.root);
        const data = listView(checked, local.resolved === true, {
          ...(local.type ? { type: local.type } : {}),
          ...(local.layer ? { layer: local.layer } : {}),
        });
        await new ListTreePrompt(data).prompt();
      } catch (cause) {
        const failure =
          cause instanceof InlayError
            ? cause
            : new InlayError(error("internal-error", (cause as Error).message), 3);
        for (const item of failure.diagnostics) console.error(renderDiagnostic(item));
        process.exitCode = failure.exitCode;
      }
      return;
    }
    await execute("list", options, async () => ({
      data:
        local.type || local.layer
          ? listView(await checkPack(options.root), local.resolved === true, {
              ...(local.type ? { type: local.type } : {}),
              ...(local.layer ? { layer: local.layer } : {}),
            })
          : await listPack(options.root, local.resolved === true),
    }));
  });

program
  .command("status")
  .description("inspect and reconcile the playable instance")
  .action(async (_local, command) => {
    const options = globalOptions(command);
    if (options.interactive && options.json !== true && options.dryRun !== true) {
      try {
        await interactiveStatus(options.root);
      } catch (cause) {
        const failure =
          cause instanceof InlayError
            ? cause
            : new InlayError(error("internal-error", (cause as Error).message), 3);
        for (const item of failure.diagnostics) console.error(renderDiagnostic(item));
        process.exitCode = failure.exitCode;
      }
      return;
    }
    await execute("status", options, async () => {
      const report = await status(options.root);
      return {
        data: report,
        diagnostics:
          report.unresolved > 0
            ? [error("status-unresolved", `${report.unresolved} instance path(s) require reconciliation.`)]
            : [],
      };
    });
  });

program
  .command("reconcile")
  .description("reconcile one unresolved file or every unresolved file below a directory")
  .argument("<path>", "instance-relative file or directory")
  .option("--action <action>", "add, record, remove, exclude, restore, upstream, or preserve")
  .action(async (target, local, command) => {
    const options = globalOptions(command);
    let reconciled = false;
    await execute("reconcile", options, async () => {
      const data = await reconcileTarget(options.root, target.replaceAll("\\", "/"), {
        interactive: options.interactive,
        ...(local.action === undefined ? {} : { action: local.action as ReconcileAction }),
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      });
      reconciled = options.dryRun !== true;
      return { data, changed: reconciled };
    });
    if (reconciled && options.interactive && options.json !== true) {
      await commitStaged(options.root, { interactive: true });
    }
  });

program
  .command("build")
  .description("preflight, validate, and deterministically build an mrpack")
  .option("--output <directory>", "output directory", "dist")
  .option("--target <destination...>", "publication destinations: github and/or modrinth")
  .action(async (local, command) => {
    const options = globalOptions(command);
    await execute<unknown>("build", options, async () => {
      const report = await status(options.root);
      if (report.unresolved > 0) {
        if (options.interactive && options.json !== true && options.dryRun !== true)
          await interactiveStatus(options.root);
        const refreshed = await status(options.root);
        if (refreshed.unresolved > 0)
          throw new InlayError(
            error("status-unresolved", `${refreshed.unresolved} path(s) still require reconciliation.`),
          );
      }
      if (options.dryRun) {
        const checked = await checkPack(options.root);
        return {
          data: { wouldBuild: true, lineage: checked.pack.lineage },
          diagnostics: checked.diagnostics,
        };
      }
      const built = await buildPack(options.root, {
        outputDirectory: local.output,
        publicationTargets: (local.target ?? []) as PublicationTarget[],
      });
      return { data: built, diagnostics: built.diagnostics, changed: true };
    });
  });

program
  .command("materialize")
  .description("hydrate manifest-managed non-Git content")
  .option("--environment <environment>", "client or server", "client")
  .action(async (local, command) => {
    const options = globalOptions(command);
    await execute<unknown>("materialize", options, async () => {
      if (options.dryRun) {
        const checked = await checkPack(options.root);
        const environment = local.environment as Environment;
        return {
          data: {
            environment,
            files: [...checked.pack.slots.entries()]
              .filter(([slot]) => slot.endsWith(`\0${environment}`))
              .map(([, content]) => ({ path: content.path, owner: content.owner })),
          },
          diagnostics: checked.diagnostics,
        };
      }
      return { data: await materialize(options.root, local.environment as Environment), changed: true };
    });
  });

program
  .command("fetch")
  .description("Git fetch plus verified external-content prefetch")
  .action(async (_local, command) => {
    const options = globalOptions(command);
    await execute("fetch", options, async () => ({
      data: options.dryRun
        ? { wouldRun: ["git fetch", "prefetch verified content"] }
        : await fetchLayer(options.root),
    }));
  });

program
  .command("pull")
  .description("Git pull, then hydrate non-Git managed content")
  .option("--environment <environment>", "client or server", "client")
  .action(async (local, command) => {
    const options = globalOptions(command);
    await execute("pull", options, async () => ({
      data: options.dryRun
        ? { wouldRun: ["git pull", `materialize ${local.environment} content`] }
        : await pullLayer(options.root, local.environment as Environment),
      changed: options.dryRun !== true,
    }));
  });

program
  .command("switch")
  .alias("checkout")
  .description("Git switch, then hydrate non-Git managed content")
  .argument("<branch>")
  .option("--environment <environment>", "client or server", "client")
  .action(async (branch, local, command) => {
    const options = globalOptions(command);
    await execute("switch", options, async () => ({
      data: options.dryRun
        ? { wouldRun: [`git switch ${branch}`, `materialize ${local.environment} content`] }
        : await switchLayer(options.root, branch, local.environment as Environment),
      changed: options.dryRun !== true,
    }));
  });

const parent = program.command("parent").description("inspect or change the immutable parent reference");
parent.command("show").action(async (_local, command) => {
  const options = globalOptions(command);
  await execute("parent show", options, async () => ({
    data: (await readManifest(options.root)).manifest.extends ?? null,
  }));
});
for (const verb of ["set", "update"] as const) {
  parent
    .command(verb)
    .argument("<source>")
    .argument("[selector]")
    .option("--filename <filename>")
    .action(async (source, selector, local, command) => {
      const options = globalOptions(command);
      await execute(`parent ${verb}`, options, async () => ({
        data: await setParent(options.root, source, {
          version: selector,
          filename: local.filename,
          ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
        }),
        changed: options.dryRun !== true,
      }));
    });
}
parent.command("remove").action(async (_local, command) => {
  const options = globalOptions(command);
  await execute("parent remove", options, async () => ({
    data: await removeParent(options.root, options.dryRun === true),
    changed: options.dryRun !== true,
  }));
});

program
  .command("commit")
  .description("validate and commit every staged path")
  .option("-m, --message <context>", "append maintainer context to the generated body")
  .action(async (local, command) => {
    const options = globalOptions(command);
    await execute("commit", options, async () => ({
      data: await commitStaged(options.root, {
        ...(local.message === undefined ? {} : { context: String(local.message) }),
        interactive: options.interactive,
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      }),
      changed: options.dryRun !== true,
    }));
  });

program
  .command("add")
  .alias("install")
  .alias("i")
  .description("install compatible Modrinth content and its required dependencies")
  .argument("<project>", "Modrinth project slug or ID")
  .option("--version <version-id>", "install one exact Modrinth version")
  .option("--channel <channel>", "release, beta, or alpha")
  .action(async (project, local, command) => {
    const options = globalOptions(command);
    await execute("add", options, async () => ({
      data: await addContent(options.root, project, {
        interactive: options.interactive,
        ...(local.version ? { version: local.version } : {}),
        ...(local.channel ? { releaseChannel: local.channel } : {}),
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      }),
      changed: options.dryRun !== true,
    }));
  });

program
  .command("remove")
  .alias("rm")
  .alias("uninstall")
  .description("remove content and reconcile its dependency graph")
  .argument("<content>", "resolved path, Modrinth project ID, or exact project name")
  .option("--dependents <policy>", "remove or abort")
  .option("--orphans <policy>", "remove or keep")
  .action(async (target, local, command) => {
    const options = globalOptions(command);
    await execute("remove", options, async () => ({
      data: await removeContent(options.root, target, {
        interactive: options.interactive,
        ...(local.dependents ? { dependents: local.dependents } : {}),
        ...(local.orphans ? { orphans: local.orphans } : {}),
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      }),
      changed: options.dryRun !== true,
    }));
  });

program
  .command("update")
  .description("discover viable updates, or adopt one exact owned update")
  .argument("[content]", "owned path, Modrinth project ID, or exact project name")
  .option("--check", "report newest viable candidates without changing files")
  .action(async (target, local, command) => {
    const options = globalOptions(command);
    await execute<unknown>("update", options, async () => {
      if (local.check || !target) return { data: await discoverUpdates(options.root) };
      return {
        data: await updateContent(options.root, target, options.interactive, options.dryRun === true),
        changed: options.dryRun !== true,
      };
    });
  });

program
  .command("docs")
  .description("generate provenance-aware content and license documentation")
  .option("--content", "regenerate the resolved content list")
  .option("--licenses", "regenerate the license and attribution report")
  .option("--stubs", "create manual metadata stubs where provider metadata is incomplete")
  .action(async (local, command) => {
    const options = globalOptions(command);
    const explicit = local.content || local.licenses || local.stubs;
    await execute<unknown>("docs", options, async () => {
      if (options.dryRun) {
        const checked = await checkPack(options.root);
        return { data: { files: checked.inventory.content.length }, diagnostics: checked.diagnostics };
      }
      const generated = await generateDocs(options.root, {
        content: explicit ? local.content === true : true,
        licenses: explicit ? local.licenses === true : true,
        stubs: local.stubs === true,
      });
      return { data: generated, diagnostics: generated.diagnostics, changed: generated.written.length > 0 };
    });
  });

program
  .command("changes")
  .description("create a structured pack-domain change fragment from staged changes")
  .option("--bump <bump>", "patch, minor, or major")
  .option("-m, --message <message>", "human release-note context")
  .action(async (local, command) => {
    const options = globalOptions(command);
    await execute("changes", options, async () => ({
      data: await createChange(options.root, {
        interactive: options.interactive,
        ...(local.bump ? { bump: local.bump } : {}),
        ...(local.message ? { message: local.message } : {}),
        ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      }),
      changed: options.dryRun !== true,
    }));
  });

program
  .command("version")
  .description("consume change fragments, bump versionId, and update CHANGELOG.md")
  .option("--docs", "regenerate content documentation")
  .option("--licenses", "regenerate license documentation")
  .action(async (local, command) => {
    const options = globalOptions(command);
    await execute("version", options, async () => {
      const versioned = await versionLayer(options.root, { dryRun: options.dryRun === true });
      if (options.dryRun) return { data: versioned };
      let content = local.docs === true;
      let licenses = local.licenses === true;
      if (options.interactive && options.json !== true && !content) {
        const answer = await p.confirm({
          message: "Update docs with the resolved content list?",
          initialValue: true,
        });
        if (!p.isCancel(answer)) content = answer;
      }
      if (options.interactive && options.json !== true && !licenses) {
        const answer = await p.confirm({
          message: "Update docs with the license report?",
          initialValue: true,
        });
        if (!p.isCancel(answer)) licenses = answer;
      }
      if (content || licenses) await generateDocs(options.root, { content, licenses, stubs: false });
      return { data: versioned, changed: true };
    });
  });

program
  .command("migrate")
  .description("migrate a manifest by at most one schema major")
  .argument("[schema-version]")
  .action(async (target, _local, command) => {
    const options = globalOptions(command);
    await execute("migrate", options, async () => ({
      data: await migrateManifest(options.root, target, options.dryRun === true),
      changed: false,
    }));
  });

await program.parseAsync();
