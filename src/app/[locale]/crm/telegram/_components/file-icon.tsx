import {
  FileIcon,
  FileTextIcon,
  FileSpreadsheetIcon,
  FileImageIcon,
  FileArchiveIcon,
} from "lucide-react";

/** Pick a lucide icon for a chat file attachment by name/extension. */
export function FileTypeIcon({
  nameOrExt,
  className = "size-5",
}: {
  nameOrExt: string;
  className?: string;
}) {
  const ext = (nameOrExt.split(".").pop() ?? nameOrExt).toLowerCase();
  switch (ext) {
    case "pdf":
    case "doc":
    case "docx":
    case "rtf":
    case "txt":
      return <FileTextIcon className={className} />;
    case "xls":
    case "xlsx":
    case "csv":
      return <FileSpreadsheetIcon className={className} />;
    case "zip":
      return <FileArchiveIcon className={className} />;
    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
    case "gif":
      return <FileImageIcon className={className} />;
    default:
      return <FileIcon className={className} />;
  }
}
