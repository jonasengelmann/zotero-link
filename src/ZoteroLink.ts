import { App, Editor, Modal, Plugin, Setting } from "obsidian"
import { pluginApi } from "@vanakat/plugin-api"
import { ZoteroItem as OriginalZoteroItem } from "@vanakat/zotero-bridge"
import * as pdfjsLib from "pdfjs-dist"
import type { PDFDocumentProxy, getDocument } from "pdfjs-dist"
import { readFileSync } from "fs"

// @ts-ignore — resolved by the esbuild plugin above
import pdfjsWorkerCode from "pdfjs-dist/build/pdf.worker.mjs"

pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
  new Blob([pdfjsWorkerCode], { type: "text/javascript" }),
)

type DocumentInitParameters = Parameters<typeof getDocument>[0]

interface ZoteroItem extends OriginalZoteroItem {
  getPdfAttachmentId(): string | null
  getCreatorSummary(): string
  getPdfFilepath(): string
}

function formatShortName(item: ZoteroItem, startPage?: string, endPage?: string) {
  const year = item.getDate()?.year ?? "n.d."
  let shortName = `${item.getCreatorSummary()}, ${year}`
  if (startPage && endPage) {
    shortName += ", pp. " + startPage + "-" + endPage
  } else if (startPage) {
    shortName += ", p. " + startPage
  }
  return `([${shortName}](zotero://select/library/items/${item.getKey()}))`
}

function formatPdfLink(item: ZoteroItem, pageNumber?: string) {
  const pdfId = item.getPdfAttachmentId()
  if (!pdfId) return ""

  let pdfUrl = `zotero://open-pdf/library/items/${pdfId}`
  if (pageNumber) {
    pdfUrl += `?page=${pageNumber}`
  }
  return `([pdf](${pdfUrl}))`
}

function formatItemLink(
  item: ZoteroItem,
  startPage?: string,
  endPage?: string,
  startPdfPage?: string,
) {
  const shortName = formatShortName(item, startPage, endPage)
  const pdfAttachmentId = item.getPdfAttachmentId()

  if (!pdfAttachmentId) {
    return shortName
  }

  return `${shortName} ${formatPdfLink(item, startPdfPage)}`
}

async function getPdfPageMap(
  pdfSource: string | Uint8Array | ArrayBuffer,
): Promise<Map<string, number>> {
  const pdfConfig: DocumentInitParameters = {}

  if (typeof pdfSource === "string") {
    const fileBuffer = readFileSync(pdfSource)
    pdfConfig.data = new Uint8Array(fileBuffer)
  } else {
    pdfConfig.data = pdfSource
  }

  const loadingTask = pdfjsLib.getDocument(pdfConfig)
  const pdfDocument: PDFDocumentProxy = await loadingTask.promise

  const pageLabels: string[] | null = await pdfDocument.getPageLabels()
  const labelToPhysicalMap = new Map<string, number>()
  const totalPages: number = pdfDocument.numPages

  if (pageLabels && pageLabels.length > 0) {
    pageLabels.forEach((label: string, index: number) => {
      labelToPhysicalMap.set(label, index + 1)
    })
  } else {
    for (let i = 1; i <= totalPages; i++) {
      labelToPhysicalMap.set(i.toString(), i)
    }
  }
  return labelToPhysicalMap
}

export class ZoteroLink extends Plugin {
  async onload() {
    this.addCommand({
      id: "zotero-link-insert-item",
      name: "Insert Zotero Item",
      editorCallback: async (editor: Editor) => {
        pluginApi("ZoteroBridge")
          .v1()
          .search()
          .then((item: ZoteroItem) => {
            editor.replaceRange(formatItemLink(item), editor.getCursor())
          })
      },
    })

    this.addCommand({
      id: "zotero-link-insert-item-with-page-information",
      name: "Insert Zotero Item PDF Page / Range",
      editorCallback: async (editor: Editor) => {
        pluginApi("ZoteroBridge")
          .v1()
          .search()
          .then(async (item: ZoteroItem) => {
            const rawFilepath = item.getPdfFilepath()
            let map: Map<string, number> | null = null
            let warningMessage: string | null = null

            if (!rawFilepath) {
              warningMessage = "No PDF attachment found for this item."
            } else {
              const filepath = decodeURIComponent(rawFilepath)
              try {
                map = await getPdfPageMap(filepath)
              } catch (error) {
                console.error("Failed to read PDF file:", error)
                warningMessage = "Could not read or process the attached PDF file."
              }
            }

            new PageRangeModal(this.app, warningMessage, map, (startPage, endPage) => {
              if (!startPage) return

              const startPdfPage = map
                ? String(map.get(startPage) ?? startPage)
                : startPage

              editor.replaceRange(
                formatItemLink(item, startPage, endPage, startPdfPage),
                editor.getCursor(),
              )
            }).open()
          })
      },
    })
  }
}

export class PageRangeModal extends Modal {
  startPage: string = ""
  endPage: string = ""
  warningMessage: string | null = null
  pageMap: Map<string, number> | null = null
  errorEl: HTMLElement | null = null
  onSubmit: (startPage: string, endPage: string) => void

  constructor(
    app: App,
    warningMessage: string | null,
    pageMap: Map<string, number> | null,
    onSubmit: (startPage: string, endPage: string) => void,
  ) {
    super(app)
    this.warningMessage = warningMessage
    this.pageMap = pageMap
    this.onSubmit = onSubmit
  }

  onOpen() {
    const { contentEl } = this
    contentEl.empty()

    if (this.warningMessage) {
      contentEl.createEl("div", {
        text: this.warningMessage,
        cls: "mod-warning",
        attr: {
          style: "color: var(--text-accent); margin-bottom: 1em; font-weight: bold;",
        },
      })
    }

    this.errorEl = contentEl.createEl("div", {
      attr: {
        style:
          "color: var(--text-error); margin-bottom: 1em; font-weight: bold; display: none;",
      },
    })

    new Setting(contentEl).setName("Start Page").addText((text) => {
      text.onChange((value) => {
        this.startPage = value.trim()
        this.clearError()
      })
      text.inputEl.focus()
    })

    new Setting(contentEl)
      .setName("End Page")
      .setDesc("leave empty for single page")
      .addText((text) =>
        text.onChange((value) => {
          this.endPage = value.trim()
          this.clearError()
        }),
      )

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Submit")
        .setCta()
        .onClick(() => {
          this.submit()
        }),
    )

    this.scope.register([], "Enter", (evt: KeyboardEvent) => {
      if (evt.isComposing) return
      this.submit()
    })
  }

  private getAvailablePageRangeText(): string {
    if (!this.pageMap || this.pageMap.size === 0) return ""

    const keys = Array.from(this.pageMap.keys())
    const firstKey = keys[0]
    const lastKey = keys[keys.length - 1]

    // Check if keys are consecutive integers
    const allNumeric = keys.every((k) => !isNaN(Number(k)))

    if (allNumeric) {
      return `(${firstKey} - ${lastKey})`
    }

    return `("${firstKey}" to "${lastKey}")`
  }

  private showError(message: string) {
    if (this.errorEl) {
      this.errorEl.setText(message)
      this.errorEl.style.display = "block"
    }
  }

  private clearError() {
    if (this.errorEl) {
      this.errorEl.setText("")
      this.errorEl.style.display = "none"
    }
  }

  private submit() {
    if (!this.startPage) return

    if (this.pageMap) {
      const rangeInfo = this.getAvailablePageRangeText()

      if (!this.pageMap.has(this.startPage)) {
        this.showError(`Start page "${this.startPage}" outside range ${rangeInfo}.`)
        return
      }

      if (this.endPage && !this.pageMap.has(this.endPage)) {
        this.showError(`End page "${this.endPage}" outside range ${rangeInfo}.`)
        return
      }
    }

    this.close()
    this.onSubmit(this.startPage, this.endPage)
  }

  onClose() {
    const { contentEl } = this
    contentEl.empty()
  }
}
