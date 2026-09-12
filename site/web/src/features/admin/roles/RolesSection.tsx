// PLAN-017 §36: роли и права — GET /admin/roles + GET /admin/permissions.
// Сетка ролей (permissions chips + members) и каталог прав по группам.
"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound, ShieldCheck } from "lucide-react";
import { fetchAdminPermissions, fetchAdminRoles } from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { AdminChip } from "@/components/admin/chips";
import { roleLabel } from "@/components/admin/labels";

function RolesGrid() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: fetchAdminRoles,
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingSpinner label="Загрузка ролей..." />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const roles = data?.roles ?? [];
  if (roles.length === 0) return <EmptyState title="Роли не описаны" />;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {roles.map((r) => (
        <Card key={r.role} className="shadow-card">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 font-semibold">
                <KeyRound className="h-4 w-4 text-accent" aria-hidden />
                {r.label || roleLabel(r.role)}
              </p>
              <AdminChip tone="muted">
                Участников: <span className="tabular-nums">{r.members ?? 0}</span>
              </AdminChip>
            </div>
            <p className="font-mono text-[11px] text-content-muted/70">{r.role}</p>
            <div className="flex flex-wrap gap-1.5">
              {(r.permissions ?? []).length === 0 ? (
                <p className="text-xs text-content-muted">Права не назначены</p>
              ) : (
                (r.permissions ?? []).map((permission) => (
                  <AdminChip key={permission} tone="info">
                    {permission}
                  </AdminChip>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PermissionsCatalog() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "permissions"],
    queryFn: fetchAdminPermissions,
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingSpinner label="Загрузка прав..." />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const permissions = data?.permissions ?? [];
  if (permissions.length === 0) return <EmptyState title="Каталог прав пуст" />;

  // Группировка по `group` с сохранением порядка появления.
  const groups: [string, typeof permissions][] = [];
  const byGroup = new Map<string, typeof permissions>();
  for (const permission of permissions) {
    const group = permission.group || "Прочее";
    const list = byGroup.get(group) ?? [];
    list.push(permission);
    byGroup.set(group, list);
  }
  for (const [group, list] of byGroup) groups.push([group, list]);

  return (
    <div className="space-y-4">
      {groups.map(([group, list]) => (
        <div key={group}>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">{group}</p>
          <ul className="grid gap-1.5 md:grid-cols-2">
            {list.map((permission) => (
              <li key={permission.key} className="rounded-md border border-line p-2.5 text-sm">
                <p className="font-mono text-xs text-content">{permission.key}</p>
                <p className="font-medium">{permission.label}</p>
                {permission.description ? (
                  <p className="mt-0.5 text-xs text-content-secondary">{permission.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function RolesSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="h-5 w-5 text-accent" aria-hidden /> Роли
        </h2>
        <p className="mt-0.5 text-sm text-content-secondary">
          Кто чем управляет и сколько участников в каждой роли
        </p>
        <div className="mt-3">
          <RolesGrid />
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Каталог прав</CardTitle>
          <CardDescription>Все разрешения платформы по группам</CardDescription>
        </CardHeader>
        <CardContent>
          <PermissionsCatalog />
        </CardContent>
      </Card>
    </div>
  );
}