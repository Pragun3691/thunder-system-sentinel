const ALLOWED_VARIABLES = [
  "NODE_ENV",
  "OS",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "LANG",
  "SHELL",
  "COMSPEC",
  "TERM",
];

export function collectEnvironmentVariables() {
  return Object.fromEntries(
    ALLOWED_VARIABLES.map((name) => [
      name,
      process.env[name] ?? "Unavailable",
    ]),
  );
}
