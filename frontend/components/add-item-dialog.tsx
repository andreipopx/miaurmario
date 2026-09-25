'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Loader2, ImagePlus, Link2 } from 'lucide-react';
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
import { useCreateItem } from '@/lib/hooks/use-items';
import { CLOTHING_TYPES, CLOTHING_COLORS } from '@/lib/types';
import { Stinky } from '@/components/stinky/stinky';
import { cn } from '@/lib/utils';
import { AIUnavailableNotice } from '@/components/ai/ai-unavailable-notice';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import { useColorLabel } from '@/lib/tag-labels';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { CareLabelField } from '@/components/add-item/care-label-field';
import { LinkImportTab } from '@/components/add-item/link-import-tab';
import { CareDraft } from '@/lib/hooks/use-intake';
import { supportsShareTarget } from '@/lib/pwa/platform';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Pre-filled intake, e.g. a photo or a link the system share sheet sent us.
   * It only fills the form in — the user still reviews and saves.
   */
  initial?: AddItemInitial | null;
  /** Hand over to the batch uploader; the "muchas" tab is only a signpost to it. */
  onBulk?: () => void;
}

export interface AddItemInitial {
  file?: File | null;
  link?: string | null;
  name?: string | null;
}

export function AddItemDialog({ open, onOpenChange, initial, onBulk }: AddItemDialogProps) {
  const t = useTranslations('wardrobe.add');
  const tBulk = useTranslations('bulkUpload');
  const tShare = useTranslations('wardrobe.share');
  const colorLabel = useColorLabel();
  const typeLabel = useClothingTypeLabel();
  // Single upload state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [care, setCare] = useState<CareDraft | null>(null);

  const [activeTab, setActiveTab] = useState('single');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Track blob URLs for cleanup on unmount
  const blobUrlsRef = useRef<Set<string>>(new Set());

  // On iOS (and Firefox) nothing can be shared into the app, so say so here
  // instead of letting people hunt for a share option that does not exist.
  const [noShareTarget, setNoShareTarget] = useState(false);
  useEffect(() => {
    setNoShareTarget(!supportsShareTarget(navigator.userAgent, navigator.maxTouchPoints || 0));
  }, []);

  const createItem = useCreateItem();
  const { data: aiStatus } = useAIStatus();
  // Users without AI still upload normally; items are saved untagged.
  const noVisionAi = Boolean(
    aiStatus && aiStatus.server_ai_enabled && !aiStatus.capabilities.vision
  );

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
    };
  }, []);

  // A shared photo or link (Web Share Target) lands in the right tab, filled in.
  useEffect(() => {
    if (!open || !initial) return;
    if (initial.file) {
      setFile(initial.file);
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(initial.file);
    }
    if (initial.name) setName(initial.name.slice(0, 100));
    if (initial.link) {
      setActiveTab('link');
    }
  }, [open, initial]);

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

  const { getRootProps: getSingleRootProps, getInputProps: getSingleInputProps, isDragActive: isSingleDragActive } = useDropzone({
    onDrop: onDropSingle,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.heic', '.heif'],
    },
    maxFiles: 1,
    multiple: false,
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
    if (sourceUrl) formData.append('source_url', sourceUrl);
    if (care) formData.append('care', JSON.stringify(care));

    try {
      await createItem.mutateAsync(formData);
      handleClose();
    } catch (error) {
      console.error('Failed to create item:', error);
    }
  };

  // Check if there are unsaved files that would be lost on close
  const hasUnsavedFiles = file !== null;

  const handleCloseRequest = () => {
    // Show confirmation if there are unsaved files and not currently uploading
    if (hasUnsavedFiles && !createItem.isPending) {
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
    setSourceUrl('');
    setCare(null);

    setActiveTab('single');
    setShowCloseConfirm(false);

    onOpenChange(false);
  };

  const clearSingleFile = () => {
    setFile(null);
    setPreview(null);
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
          {/* Three tabs have to fit a 320px phone at 125% font: let them
              shrink and ellipsize instead of pushing the dialog wider. */}
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="single" className="min-w-0 truncate px-2 text-xs sm:px-4 sm:text-sm">
              {t('tabSingle')}
            </TabsTrigger>
            <TabsTrigger value="link" className="min-w-0 truncate px-2 text-xs sm:px-4 sm:text-sm">
              {t('tabLink')}
            </TabsTrigger>
            <TabsTrigger value="bulk" className="min-w-0 truncate px-2 text-xs sm:px-4 sm:text-sm">
              {t('tabBulk')}
            </TabsTrigger>
          </TabsList>

          {/* Paste a shop link: read on the server, reviewed here */}
          <TabsContent value="link" className="space-y-4">
            <LinkImportTab
              initialUrl={initial?.link ?? null}
              onCancel={handleCloseRequest}
              onUse={(prefill) => {
                if (prefill.file) {
                  setFile(prefill.file);
                  const reader = new FileReader();
                  reader.onloadend = () => setPreview(reader.result as string);
                  reader.readAsDataURL(prefill.file);
                }
                if (prefill.name) setName(prefill.name.slice(0, 100));
                if (prefill.brand) setBrand(prefill.brand.slice(0, 100));
                if (prefill.primaryColor) setPrimaryColor(prefill.primaryColor);
                setSourceUrl(prefill.sourceUrl);
                setActiveTab('single');
              }}
            />
          </TabsContent>

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
                  {noShareTarget && (
                    <p className="mt-2 text-xs text-muted-foreground">{tShare('iosHint')}</p>
                  )}
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
                          {typeLabel(ty.value)}
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
                              {colorLabel(c.value)}
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

                {sourceUrl && (
                  <div className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2">
                    <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {sourceUrl}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setSourceUrl('')}
                      aria-label={t('removeLink')}
                    >
                      <X className="h-4 w-4" strokeWidth={1.75} />
                    </Button>
                  </div>
                )}

                <CareLabelField value={care} onChange={setCare} idPrefix="add-care" />
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

          {/* Many photos at once is its own flow, with a resumable queue and a
              review pass; this tab only hands over to it so there is one bulk
              uploader in the app rather than two. */}
          <TabsContent value="bulk" className="space-y-4">
            <div className="rounded-lg bg-panel p-5 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-signature text-signature-foreground">
                <ImagePlus className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <p className="mt-3 text-[15px] font-bold">{tBulk('handoff.title')}</p>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {tBulk('handoff.body')}
              </p>
              <Button
                type="button"
                className="mt-4 w-full"
                onClick={() => {
                  handleClose();
                  onBulk?.();
                }}
              >
                <ImagePlus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                {tBulk('cta')}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('closeConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('closeConfirmSingle')}</AlertDialogDescription>
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
