import { useState, useRef, DragEvent } from 'react';
import { Upload, FolderUp } from 'lucide-react';
import { useFileStore } from '../../stores/files';
import { useI18n } from '../../i18n';

interface FileUploadZoneProps {
  groupJid: string;
}

export function FileUploadZone({ groupJid }: FileUploadZoneProps) {
  const { t } = useI18n();
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { uploadFiles, uploading, uploadProgress } = useFileStore();

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const fileList = e.dataTransfer.files;
    if (fileList.length > 0) {
      await uploadFiles(groupJid, Array.from(fileList));
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      await uploadFiles(groupJid, Array.from(fileList));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      await uploadFiles(groupJid, Array.from(fileList));
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  const progressPercent =
    uploadProgress && uploadProgress.totalBytes > 0
      ? Math.round((uploadProgress.uploadedBytes / uploadProgress.totalBytes) * 100)
      : 0;

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative rounded-lg border border-dashed p-3 transition-all ${
          isDragging
            ? 'border-primary bg-brand-50/45'
            : 'border-sidebar-border bg-background'
        } ${uploading ? 'pointer-events-none' : ''}`}
      >
        {/* Hidden inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          disabled={uploading}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory is non-standard but widely supported
          webkitdirectory=""
          onChange={handleFolderSelect}
          className="hidden"
          disabled={uploading}
        />

        {uploading && uploadProgress ? (
          /* Upload progress */
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="truncate max-w-[60%]">{uploadProgress.currentFile || t('chat.fileUploadZone.done')}</span>
              <span>{t('chat.fileUploadZone.fileCount', { completed: uploadProgress.completed, total: uploadProgress.total })}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground text-center">{progressPercent}%</p>
          </div>
        ) : (
          /* Idle state */
            <div className="flex flex-col items-center gap-2 py-1 text-center">
              <p className="text-xs text-muted-foreground">
                {isDragging ? t('chat.fileUploadZone.dropToUpload') : t('chat.fileUploadZone.dragHint')}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex cursor-pointer items-center gap-1 rounded-md bg-brand-50 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-brand-100"
                >
                <Upload className="w-3.5 h-3.5" />
                {t('chat.fileUploadZone.uploadFile')}
              </button>
                <button
                  onClick={() => folderInputRef.current?.click()}
                  className="flex cursor-pointer items-center gap-1 rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
                >
                <FolderUp className="w-3.5 h-3.5" />
                {t('chat.fileUploadZone.uploadFolder')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
