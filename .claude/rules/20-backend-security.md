---
paths:
  - "backend/**"
  - "api/**"
  - "server/**"
  - "src/api/**"
---

# Backend and security rules

- Validate all uploaded files, sizes, formats, and request fields.
- Enforce authentication and resource ownership on the server; never trust client-supplied user or machine ownership.
- Keep secrets in environment variables; commit only safe `.env.example` placeholders.
- Use explicit API schemas and consistent error responses.
- Do not expose filesystem paths, stack traces, secrets, or internal model artifacts.
- Add tests for authorization boundaries and invalid inputs.
