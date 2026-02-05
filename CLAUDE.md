# ChurchAudioStream - Project Rules

## Coding Standards

1. **DRY** (Don't Repeat Yourself) — Extract shared logic into reusable functions/modules
2. **SRP** (Single Responsibility Principle) — Each function/module/class does one thing
3. **Self-explanatory naming** — Variables, functions, classes, and files must have descriptive names that convey intent without needing comments
   - Bad: `d`, `tmp`, `data`, `handleIt`, `processStuff`
   - Good: `heartbeatIntervalMs`, `configFilePath`, `broadcastToAdminClients`, `parseLogLevel`
