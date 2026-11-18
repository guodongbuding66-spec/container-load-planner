import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkspaceFileMenu } from "./workspace-file-menu";

function renderMenu(planBlockReason?: string) {
  const action = () => {};
  return renderToStaticMarkup(<WorkspaceFileMenu
    menuRef={createRef<HTMLDetailsElement>()}
    backupBlocked={false}
    restoreBlocked={false}
    planBlockReason={planBlockReason}
    onBackUp={action}
    onRestore={action}
    onPrint={action}
    onExport={action}
    onSample={action}
  />);
}

it("leaves workspace actions available and explains why plan outputs are disabled", () => {
  const reason = "先计算装柜方案，即可打印或导出。";
  const html = renderMenu(reason);
  expect(html).toContain('name="workspace-menus"');
  expect(html).toContain('role="group" aria-label="工作区文件"');
  expect(html).toContain('role="group" aria-label="当前方案"');
  expect(html).toContain(reason);
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  for (const label of ["备份工作区", "恢复工作区", "打印现场指导书", "导出方案 JSON", "载入示例"]) {
    expect(html).toContain(label);
  }
});

it("makes both plan actions available when a checked result is ready", () => {
  expect(renderMenu()).not.toContain('disabled=""');
});
