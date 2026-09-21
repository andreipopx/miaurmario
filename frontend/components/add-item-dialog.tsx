'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Loader2, CheckCircle2, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateItem, useBulkCreateItems, BulkUploadResponse } from '@/lib/hooks/use-items';
import { CLOTHING_TYPES, CLOTHING_COLORS } from '@/lib/types';
import { Stinky } from '@/components/stinky/stinky';
import { cn } from '@/lib/utils';
import { AIUnavailableNotice } from '@/components/ai/ai-unavailable-notice';
import { useAIStatus } from '@/lib/hooks/use-ai-access';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FileWithPreview {
  file: File;
  preview: string;
  id: string;
}

export function AddItemDialog({ open, onOpenChange }: AddItemDialogProps) {
  const t = useTranslations('wardrobe.add');
  // Single upload state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [notes, setNotes] = useState('');

  // Bulk upload state
  const [bulkFiles, setBulkFiles] = useState<FileWithPreview[]>([]);
  const [bulkResult, setBulkResult] = useState<BulkUploadResponse | null>(null);
  const [skipAi, setSkipAi] = useState(false);
  const [activeTab, setActiveTab] = useState('single');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Track blob URLs for cleanup on unmount
  const blobUrlsRef = useRef<Set<string>>(new Set());

  const createItem = useCreateItem();
  const { data: aiStatus } = useAIStatus();
  // Users without AI still upload normally; items are saved untagged.
  const noVisionAi = Boolean(
    aiStatus && aiStatus.server_ai_enabled && !aiStatus.capabilities.vision
  );
  const bulkCreateItems = useBulkCreateItems();

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
    };
  }, []);

  // Single file drop handler
  const onDropSingle = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  // Bulk file drop handler
  const onDropBulk = useCallback((acceptedFiles: File[]) => {
    const newFiles: FileWithPreview[] = acceptedFiles.map((file) => {
      const preview = URL.createObjectURL(file);
      blobUrlsRef.current.add(preview);
      return {
        file,
        preview,
        id: `${file.name}-${Date.now()}-${Math.random()}`,
      };
    });
    setBulkFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const { getRootProps: getSingleRootProps, getInputProps: getSingleInputProps, isDragActive: isSingleDragActive } = useDropzone({
    onDrop: onDropSingle,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.heic', '.heif'],
    },
    maxFiles: 1,
    multiple: false,
  });

  const { getRootProps: getBulkRootProps, getInputProps: getBulkInputProps, isDragActive: isBulkDragActive } = useDropzone({
    onDrop: onDropBulk,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.heic', '.heif'],
    },
    multiple: true,
  });

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);
    // Type is optional - AI will detect if not provided
    if (type) formData.append('type', type);
    if (name) formData.append('name', name);
    if (brand) formData.append('brand', brand);
    if (primaryColor) formData.append('primary_color', primaryColor);
    if (notes) formData.append('notes', notes);

    try {
      await createItem.mutateAsync(formData);
      handleClose();
    } catch (error) {
      console.error('Failed to create item:', error);
    }
  };

  const handleBulkSubmit = async () => {
    if (bulkFiles.length === 0) return;

    try {
      const result = await bulkCreateItems.mutateAsync({
        files: bulkFiles.map((f) => f.file),
        skipAi,
      });
      setBulkResult(result);

      // Show toast based on results
      if (result.failed === 0) {
        toast.success(t('toast.bulkAllSuccess', { count: result.successful }));
      } else if (result.successful === 0) {
        toast.error(t('toast.bulkAllFailed', { count: result.failed }));
      } else {
        toast.warning(t('toast.bulkPartial', { ok: result.successful, failed: result.failed }));
      }
    } catch (error) {
      console.error('Failed to bulk upload:', error);
      toast.error(t('toast.bulkError'));
    }
  };

  // Check if there are unsaved files that would be lost on close
  const hasUnsavedFiles = (file !== null) || (bulkFiles.length > 0 && !bulkResult);

  const handleCloseRequest = () => {
    // Show confirmation if there are unsaved files and not currently uploading
    if (hasUnsavedFiles && !createItem.isPending && !bulkCreateItems.isPending) {
      setShowCloseConfirm(true);
    } else {
      handleClose();
    }
  };

  const handleClose = () => {
    // Single upload cleanup
    setFile(null);
    setPreview(null);
    setType('');
    setName('');
    setBrand('');
    setPrimaryColor('');
    setNotes('');

    // Bulk upload cleanup - also clean up from the ref
    bulkFiles.forEach((f) => {
      URL.revokeObjectURL(f.preview);
      blobUrlsRef.current.delete(f.preview);
    });
    setBulkFiles([]);
    setBulkResult(null);
    setSkipAi(false);
    setActiveTab('single');
    setShowCloseConfirm(false);

    onOpenChange(false);
  };

  const clearSingleFile = () => {
    setFile(null);
    setPreview(null);
  };

  const removeBulkFile = (id: string) => {
    setBulkFiles((prev) => {
      const fileToRemove = prev.find((f) => f.id === id);
      if (fileToRemove) {
        URL.revokeObjectURL(fileToRemove.preview);
        blobUrlsRef.current.delete(fileToRemove.preview);
      }
      return prev.filter((f) => f.id !== id);
    });
  };

  const clearBulkFiles = () => {
    bulkFiles.forEach((f) => {
      URL.revokeObjectURL(f.preview);
      blobUrlsRef.current.delete(f.preview);
    });
    setBulkFiles([]);
    setBulkResult(null);
    setSkipAi(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleCloseRequest}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        {noVisionAi && (
          <AIUnavailableNotice feature="tagging" reason={aiStatus?.blocked_reason} />
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">{t('tabSingle')}</TabsTrigger>
            <TabsTrigger value="bulk">{t('tabBulk')}</TabsTrigger>
          </TabsList>

          {/* Single Item Upload */}
          <TabsContent value="single" className="space-y-4">
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              {!preview ? (
                <div
                  {...getSingleRootProps()}
                  className={cn(
                    'cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isSingleDragActive
                      ? 'border-signature bg-signature-soft'
                      : 'border-border bg-panel hover:bg-accent'
                  )}
                >
                  <input {...getSingleInputProps()} />
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-signature text-signature-foreground">
                    <Upload className="h-6 w-6" strokeWidth={1.75} />
                  </span>
                  <p className="mt-3 text-sm font-bold text-foreground">
                    {isSingleDragActive ? t('dragDropSingleActive') : t('dragDropSingle')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('acceptedFormats')}
                  </p>
                </div>
              ) : (
                <div className="relative rounded-tile bg-panel">
                  <img
                    src={preview}
                    alt={t('previewAlt')}
                    className="h-48 w-full rounded-tile object-contain p-3"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="absolute right-2 top-2 border-0 bg-background/90 shadow-sm"
                    onClick={clearSingleFile}
                    aria-label={t('removePhoto')}
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="type" className="font-bold">{t('typeLabel')} <span className="font-normal text-muted-foreground">{t('typeHint')}</span></Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger id="type">
                      <SelectValue placeholder={t('typePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {CLOTHING_TYPES.map((ty) => (
                        <SelectItem key={ty.value} value={ty.value}>
                          {ty.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name" className="font-bold">{t('nameLabelOptional')}</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('namePlaceholder')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="brand" className="font-bold">{t('brandLabel')}</Label>
                    <Input
                      id="brand"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      placeholder={t('brandPlaceholder')}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="color" className="font-bold">{t('colorLabel')}</Label>
                    <Select value={primaryColor} onValueChange={setPrimaryColor}>
                      <SelectTrigger id="color">
                        <SelectValue placeholder={t('colorPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {CLOTHING_COLORS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            <div className="flex items-center gap-2">
                              <div
                                className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-black/10"
                                style={{ backgroundColor: c.hex }}
                              />
                              {c.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes" className="font-bold">{t('notesLabel')}</Label>
                  <Input
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={t('notesPlaceholder')}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={handleCloseRequest}>
                  {t('cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={!file || createItem.isPending}
                >
                  {createItem.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('uploading')}
                    </>
                  ) : (
                    t('addSingle')
                  )}
                </Button>
              </div>
            </form>
          </TabsContent>

          {/* Bulk Upload */}
          <TabsContent value="bulk" className="space-y-4">
            {!bulkResult ? (
              <>
                <div
                  {...getBulkRootProps()}
                  className={cn(
                    'cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isBulkDragActive
                      ? 'border-signature bg-signature-soft'
                      : 'border-border bg-panel hover:bg-accent'
                  )}
                >
                  <input {...getBulkInputProps()} />
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-signature text-signature-foreground">
                    <Upload className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <p className="mt-3 text-sm font-bold text-foreground">
                    {isBulkDragActive ? t('dragDropBulkActive') : t('dragDropBulk')}
                  </p>
                </div>

                {bulkFiles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold">
                        {t('imagesSelected', { count: bulkFiles.length })}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearBulkFiles}
                      >
                        {t('clearAll')}
                      </Button>
                    </div>

                    <ScrollArea className="h-[200px] rounded-lg bg-panel p-2">
                      <div className="grid grid-cols-4 gap-2">
                        {bulkFiles.map((f) => (
                          <div key={f.id} className="group relative">
                            <img
                              src={f.preview}
                              alt={f.file.name}
                              className="aspect-square w-full rounded-[14px] bg-background object-contain p-1"
                            />
                            <button
                              type="button"
                              className="absolute right-0.5 top-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-100 shadow-sm transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100"
                              onClick={() => removeBulkFile(f.id)}
                              aria-label={t('removeFile', { name: f.file.name })}
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                            <p className="mt-1 truncate px-1 text-[11px] text-muted-foreground">
                              {f.file.name}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    {!noVisionAi && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="skip-ai"
                        checked={skipAi}
                        onCheckedChange={(checked) => setSkipAi(checked === true)}
                      />
                      <Label htmlFor="skip-ai" className="text-xs font-normal text-muted-foreground">
                        {t('skipAiLabel')}
                      </Label>
                    </div>
                    )}
                    {!skipAi && !noVisionAi && (
                      <p className="text-xs text-muted-foreground">
                        {t('aiWillTag')}
                      </p>
                    )}
                  </div>
                )}

                {bulkCreateItems.isPending && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Stinky state="thinking" size={28} label="" />
                        <span className="text-sm font-semibold">{t('uploadingCount', { count: bulkFiles.length })}</span>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-muted-foreground">{bulkCreateItems.uploadProgress}%</span>
                    </div>
                    <Progress value={bulkCreateItems.uploadProgress} className="h-2" />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="secondary" onClick={handleCloseRequest}>
                    {t('cancel')}
                  </Button>
                  <Button
                    onClick={handleBulkSubmit}
                    disabled={bulkFiles.length === 0 || bulkCreateItems.isPending}
                  >
                    {bulkCreateItems.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('uploading')}
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" strokeWidth={1.75} />
                        {t('uploadBulk', { count: bulkFiles.length })}
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              /* Bulk Upload Results */
              <div className="space-y-4">
                <div className="flex items-center justify-center py-2">
                  <div className="flex h-28 w-28 items-center justify-center rounded-full bg-signature-soft">
                    <Stinky
                      state={bulkResult.failed === 0 ? 'happy' : bulkResult.successful === 0 ? 'sad' : 'idle'}
                      size={96}
                      label=""
                    />
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-lg font-extrabold">
                    {t('resultHeadline', { ok: bulkResult.successful, total: bulkResult.total })}
                  </p>
                  {bulkResult.failed > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t('resultFailedNote', { count: bulkResult.failed })}
                    </p>
                  )}
                </div>

                <ScrollArea className="h-[200px] rounded-lg bg-panel">
                  <div className="space-y-2 p-2">
                    {bulkResult.results.map((result, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 rounded-[14px] bg-background p-2.5"
                      >
                        {result.success ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" strokeWidth={2} />
                        ) : (
                          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" strokeWidth={2} />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{result.filename}</p>
                          {result.error && (
                            <p className="text-xs text-destructive">{result.error}</p>
                          )}
                        </div>
                        {result.item && (
                          <ImageIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="secondary" onClick={clearBulkFiles}>
                    {t('uploadMore')}
                  </Button>
                  <Button onClick={handleClose}>
                    {t('done')}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('closeConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {activeTab === 'single'
              ? t('closeConfirmSingle')
              : t('closeConfirmMultiple', { count: bulkFiles.length })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('keepEditing')}</AlertDialogCancel>
          <AlertDialogAction onClick={handleClose}>{t('discard')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
