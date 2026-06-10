#!/usr/bin/env python3
# Builds schema_template.xlsx (6 tabs) using only the Python standard library.
# No openpyxl/pandas needed — an .xlsx is an OPC zip of XML parts.
import zipfile, html

OUT = "schema_template.xlsx"

REQ = ["request_id","control_number","status","current_step","date_filed","project_title",
       "requestor_email","requestor_designation","group_id","accountable_person","department",
       "location","pc_name","prism","purchase_order","ihelp_number","product_type","product_name",
       "type_of_purchase","type_of_license","contract_start","contract_end","supplier_name",
       "requestor_remark","resubmit_count"]
ACT = ["action_id","request_id","resubmit_cycle","step","actor_email","action","remark","timestamp"]
GRP = ["group_id","group_name","active","created_at"]
GAP = ["id","group_id","sequence","approver_email","designation","active"]
RA  = ["attachment_id","request_id","filename","file_link","description","resubmit_cycle","uploaded_by","uploaded_at"]
ADM = ["email","active","added_at"]

ADMIN_EMAIL = "kyle_justin_tan@dlsu.edu.ph"

sheets = [
    ("Requests",            [REQ], []),
    ("Approval_Actions",    [ACT], []),
    ("Groups",              [GRP], [
        ["G001","ISM - InfoSec","TRUE","2026-06-09"],
        ["G002","IT - Infrastructure","TRUE","2026-06-09"],
    ]),
    ("Group_Approvers",     [GAP], [
        ["GA001","G001","1",ADMIN_EMAIL,"InfoSec Approver","TRUE"],
        ["GA002","G002","1",ADMIN_EMAIL,"Infrastructure Approver","TRUE"],
    ]),
    ("Request_Attachments", [RA], []),
    ("Admins",              [ADM], [
        [ADMIN_EMAIL,"TRUE","2026-06-09"],
    ]),
]

def col_letter(n):  # 1 -> A
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s

def esc(v):
    return html.escape(str(v), quote=False)

def sheet_xml(header_rows, data_rows, ncols):
    rows_xml = []
    r = 1
    for row in header_rows + data_rows:
        style = 1 if r == 1 else 0          # header row bold (style 1)
        cells = []
        for c, val in enumerate(row, start=1):
            ref = f"{col_letter(c)}{r}"
            if val == "" or val is None:
                cells.append(f'<c r="{ref}" s="{style}"/>')
            else:
                cells.append(f'<c r="{ref}" t="inlineStr" s="{style}"><is><t xml:space="preserve">{esc(val)}</t></is></c>')
        rows_xml.append(f'<row r="{r}">{"".join(cells)}</row>')
        r += 1
    cols = f'<cols><col min="1" max="{ncols}" width="22" customWidth="1"/></cols>'
    view = ('<sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            '</sheetView></sheetViews>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'{view}{cols}<sheetData>{"".join(rows_xml)}</sheetData></worksheet>')

STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
          '<fonts count="2"><font><sz val="11"/><name val="Arial"/></font>'
          '<font><b/><sz val="11"/><name val="Arial"/></font></fonts>'
          '<fills count="2"><fill><patternFill patternType="none"/></fill>'
          '<fill><patternFill patternType="gray125"/></fill></fills>'
          '<borders count="1"><border/></borders>'
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
          '<cellXfs count="2">'
          '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
          '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
          '</cellXfs>'
          '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
          '</styleSheet>')

n = len(sheets)
wb_sheets = "".join(
    f'<sheet name="{esc(name)}" sheetId="{i+1}" r:id="rId{i+1}"/>'
    for i, (name, _, _) in enumerate(sheets)
)
WORKBOOK = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheets>{wb_sheets}</sheets></workbook>')

wb_rels = "".join(
    f'<Relationship Id="rId{i+1}" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
    f'Target="worksheets/sheet{i+1}.xml"/>'
    for i in range(n)
)
styles_rid = n + 1
WB_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
           f'{wb_rels}'
           f'<Relationship Id="rId{styles_rid}" '
           'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
           'Target="styles.xml"/></Relationships>')

sheet_overrides = "".join(
    f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    for i in range(n)
)
CONTENT_TYPES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="xml" ContentType="application/xml"/>'
                 '<Override PartName="/xl/workbook.xml" '
                 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                 f'{sheet_overrides}'
                 '<Override PartName="/xl/styles.xml" '
                 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                 '</Types>')

ROOT_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" '
             'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
             'Target="xl/workbook.xml"/></Relationships>')

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", CONTENT_TYPES)
    z.writestr("_rels/.rels", ROOT_RELS)
    z.writestr("xl/workbook.xml", WORKBOOK)
    z.writestr("xl/_rels/workbook.xml.rels", WB_RELS)
    z.writestr("xl/styles.xml", STYLES)
    for i, (name, headers, data) in enumerate(sheets):
        ncols = len(headers[0])
        z.writestr(f"xl/worksheets/sheet{i+1}.xml", sheet_xml(headers, data, ncols))

print("wrote", OUT)
