export interface ParsedArgs {
  command: string | undefined;
  options: Map<string, string[]>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const options = new Map<string, string[]>();
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg?.startsWith("--")) {
      if (arg) positionals.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = arg.slice(2, equals === -1 ? undefined : equals);
    let value = equals === -1 ? undefined : arg.slice(equals + 1);
    if (value === undefined && rest[i + 1] && !rest[i + 1]?.startsWith("--")) {
      value = rest[i + 1];
      i += 1;
    }
    const values = options.get(name) ?? [];
    values.push(value ?? "true");
    options.set(name, values);
  }

  return { command, options, positionals };
}

export function optionValue(args: ParsedArgs, name: string): string | undefined {
  return args.options.get(name)?.at(-1);
}

export function optionValues(args: ParsedArgs, name: string): string[] {
  return args.options.get(name) ?? [];
}

export function hasOption(args: ParsedArgs, name: string): boolean {
  return args.options.has(name);
}

export function assertOptions(args: ParsedArgs, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const unknown = [...args.options.keys()].filter((name) => !allowedSet.has(name));
  if (unknown.length)
    throw new Error(`Неизвестные параметры: ${unknown.map((x) => `--${x}`).join(", ")}`);
  if (args.positionals.length) {
    throw new Error(`Неожиданные аргументы: ${args.positionals.join(" ")}`);
  }
}
