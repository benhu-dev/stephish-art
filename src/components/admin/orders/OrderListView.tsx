import { DefaultListView, Table } from "@payloadcms/ui";
import type { ListViewClientProps, ListViewServerProps } from "payload";

export const OrderListView = (props: ListViewServerProps) => {
  const table = (
    <div className="table-wrap">
      <Table columns={props.columnState} data={props.data.docs} />
    </div>
  );
  const clientProps: ListViewClientProps = {
    AfterList: props.AfterList,
    AfterListTable: props.AfterListTable,
    beforeActions: props.beforeActions,
    BeforeList: props.BeforeList,
    BeforeListTable: props.BeforeListTable,
    collectionSlug: props.collectionSlug,
    columnState: props.columnState,
    Description: props.Description,
    disableBulkDelete: true,
    disableBulkEdit: true,
    disableQueryPresets: props.disableQueryPresets,
    enableRowSelections: false,
    hasCreatePermission: props.hasCreatePermission,
    hasDeletePermission: props.hasDeletePermission,
    hasTrashPermission: props.hasTrashPermission,
    listMenuItems: props.listMenuItems,
    newDocumentURL: props.newDocumentURL,
    queryPreset: props.queryPreset,
    queryPresetPermissions: props.queryPresetPermissions,
    renderedFilters: props.renderedFilters,
    resolvedFilterOptions: props.resolvedFilterOptions,
    Table: table,
    viewType: props.viewType,
  };

  return <DefaultListView {...clientProps} />;
};
