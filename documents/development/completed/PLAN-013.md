# PLAN-013 — Visual System & UX Redesign (выполнен; запись восстановлена пост-хок)

Дата записи: 2026-09-12 (восстановлена пост-хок в PLAN-016 — исходная итоговая
запись никогда не архивировалась; см. спеку `PLAN-013-spec.md`).

## 1. Что было сделано

- **Визуальная система**: единые HSL-токены (`globals.css`), Tailwind semantic
  map, глобальные радиусы/тени, motion-хелперы (`mta-anim-ping/pulse`,
  `prefers-reduced-motion`), глобальный focus-visible ring.
- **Компонентный ui-kit**: Button/Card/Input(+Textarea/Select)/Badge/StatusBadge/
  Tabs/Skeleton/States (LoadingSpinner/EmptyState/ErrorState) — единые примитивы
  вместо per-page дизайнов.
- **Поверхности**: Home (live line, активность, популярное), Маркетплейс,
  карточки ресурсов, страницы серверов, сообщество, статьи, профиль, seller,
  admin, auth (login/register), навигация.
- **Source of truth**: `documents/architecture/DESIGN-SYSTEM.md` (dated
  2026-09-11) — принципы, токены, типографика, spacing, responsive, motion,
  a11y, checklist соответствия (§12).

## 2. Артефакты

- `documents/architecture/DESIGN-SYSTEM.md` (normative, dated 2026-09-11).
- Коммиты: `0d04531` feat(plan-013) — визуальная система; `95075e0` fix(e2e).

## 3. Известные проблемы на момент завершения

- **E2E-регрессия**: редизайн сломал 3 теста (CI red при зелёной локальной
  разработке). Root causes по PLAN-014 §3: двойное кодирование кириллицы в
  серверных шаблонах, «Новинка от [object Object]», устаревший локатор поиска
  после редизайна счётчика. Все закрыты в PLAN-014.
- **Остаточный визуальный долг** (перенесён в PLAN-016 D-004):
  - модальные фокус-трапы отсутствуют (ConfirmDialog/ReportDialog/Gallery);
  - footer claims «Безопасная оплата · политика возвратов» без страниц
    политик (приведены к факту в PLAN-016);
  - начальная тема была тёмная-only (light-theme добавлен в PLAN-015).

## 4. Ограничения

- PLAN-013 не создавал visual regression baseline (§54 не выполнен) —
  тесты `tests/e2e/visual/` отсутствуют, screenshot-ассертов нет. Приёмка
  PLAN-015/016 выполнялась в реальном браузере, но без автоматического
  visual-baseline. Кандидат в будущий план (task PLAN-016 §13 не заявляет
  baseline созданным).