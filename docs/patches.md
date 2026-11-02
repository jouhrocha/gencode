# Patches

Documentation for GenCode patches applied on top of VS Code.

---

## fix-policies

**Replace `@gencode/policy-watcher` with `@gencode/policy-watcher`**

VS Code uses `@gencode/policy-watcher` to enforce Group Policy Objects (GPOs) on
Windows. That package reads from:

```
HKLM\SOFTWARE\Policies\Microsoft\<productName>
```

GenCode forks this into `@gencode/policy-watcher`, which takes a separate
`vendorName` argument. The `createWatcher()` call becomes:

```ts
createWatcher('GenCode', this.productName, ...)
```

Because GenCode sets `product.nameLong = 'GenCode'` (via `prepare_gencode.sh`),
`this.productName` resolves to `'GenCode'` at runtime. Therefore, the final
Windows registry key that GenCode reads policies from is:

```
HKLM\SOFTWARE\Policies\GenCode\GenCode\<PolicyName>
```

(or `HKCU\SOFTWARE\Policies\GenCode\GenCode\<PolicyName>` for per-user policies)

This differs from VS Code's path (`Microsoft\GenCode`) and is the root cause of
[issue #2714](https://github.com/GenCode/gencode/issues/2714) where users mirror
VS Code's registry structure and find their GPOs ignored. Enterprise admins must
use the GenCode-specific registry path.

### References

- [GenCode issue #2714](https://github.com/GenCode/gencode/issues/2714)
- [GenCode/policy-watcher — RegistryPolicy.hh](https://github.com/GenCode/policy-watcher/blob/main/src/windows/RegistryPolicy.hh)
