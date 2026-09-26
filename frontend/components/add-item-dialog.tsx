'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, Loader2, ImagePlus, Link2, Camera } from 'lucide-react';
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
import { CLOTHING_TYPES } from '@/lib/types';
import { Stinky } from '@/components/stinky/stinky';
import { cn } from '@/lib/utils';
import { AIUnavailableNotice } from '@/components/ai/ai-unavailable-notice';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { CareLabelField } from '@/components/add-item/care-label-field';
import { LinkImportTab } from '@/components/add-item/link-import-tab';
import { ColorCaptureField } from '@/components/color-capture-field';
import { BulkUploadPanel } from '@/components/bulk-upload/bulk-upload-panel';
import { CareDraft } from '@/lib/hooks/use-intake';
import { NO_FRAMING, PhotoPreview, type PhotoFraming } from '@/components/add-item/photo-preview';
import { supportsShareTarget } from '@/lib/pwa/platform';

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Pre-filled intake, e.g. a photo or a link the system share sheet sent us.
   * It only fills the form in — the user still reviews and saves.
   */
  initial?: AddItemInitial | null;
  /** Which tab to land on; "bulk" is what ?bulk=1 and every nudge link opens. */
  initialTab?: 'single' | 'link' | 'bulk';
  /**
   * "untagged" opens the bulk tab straight into the quick pass over every garment
   * the tagger never named, rather than into the picker.
   */
  bulkMode?: 'batch' | 'untagged';
}

export interface AddItemInitial {
  file?: File | null;
  link?: string | null;
  name?: string | null;
}

export function AddItemDialog({
  open,
  onOpenChange,
  initial,
  initialTab = 'single',
  bulkMode = 'batch',
}: AddItemDialogProps) {
  const t = useTranslations('wardrobe.add');
  const tShare = useTranslations('wardrobe.share');
  const tBulk = useTranslations('bulkUpload');
  const typeLabel = useClothingTypeLabel();
  // Single upload state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  // The shade the user sampled off their own photo, kept beside the family name so
  // the card can show their brown. Undefined whenever the family came off the list.
  const [primaryColorHex, setPrimaryColorHex] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [care, setCare] = useState<CareDraft | null>(null);
  /** Turns and crop the user chose in the preview; applied server-side on save. */
  const [framing, setFraming] = useState<PhotoFraming>(NO_FRAMING);

  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  // Track blob URLs for cleanup on unmount
  const blobUrlsRef = useRef<Set<string>>(new Set());

  // Each opening lands on the tab the caller asked for: the Hoy nudge, Stinky and
  // the floating upload bar all open this dialog straight on "muchas prendas".
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  // On iOS (and Firefox) nothing can be shared into the app, so say so here
  // instead of letting people hunt for a share option that does not exist.
  const [noShareTarget, setNoShareTarget] = useState(false);
  useEffect(() => {
    setNoShareTarget(!supportsShareTarget(navigator.userAgent, navigator.maxTouchPoints || 0));
  }, []);

  /** The quick pass over garments the tagger never named: tagging, not uploading. */
  const taggingBacklog = activeTab === 'bulk' && bulkMode === 'untagged';

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
      setFraming(NO_FRAMING);
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
      // A new photo means the old sample describes a different garment, and the
      // crop and rotation belonged to the old one too.
      setPrimaryColorHex(undefined);
      setFraming(NO_FRAMING);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const {
    getRootProps: getSingleRootProps,
    getInputProps: getSingleInputProps,
    isDragActive: isSingleDragActive,
    open: openSinglePicker,
  } = useDropzone({
    onDrop: onDropSingle,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.heic', '.heif'],
    },
    maxFiles: 1,
    multiple: false,
    // The zone has its own buttons, so a stray tap on the copy must not open a
    // picker the user did not ask for.
    noClick: true,
    noKeyboard: true,
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
    if (primaryColor && primaryColorHex) formData.append('primary_color_hex', primaryColorHex);
    if (notes) formData.append('notes', notes);
    if (sourceUrl) formData.append('source_url', sourceUrl);
    if (care) formData.append('care', JSON.stringify(care));
    // The server straightens and crops: no canvas re-encode here, so nothing is
    // lost and a HEIC the browser cannot decode is still saved correctly.
    if (framing.quarters) formData.append('rotate', String(framing.quarters));
    if (framing.crop) {
      formData.append('crop_x', String(framing.crop.x));
      formData.append('crop_y', String(framing.crop.y));
      formData.append('crop_w', String(framing.crop.width));
      formData.append('crop_h', String(framing.crop.height));
    }
    // "Borra lo que sobra", in the coordinates of the turned photo. The server puts
    // it through the same framing as the pixels and applies it to the cut-out.
    if (framing.erase) formData.append('erase_mask', framing.erase, 'erase.png');

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
    setPrimaryColorHex(undefined);
    setNotes('');
    setSourceUrl('');
    setCare(null);
    setFraming(NO_FRAMING);

    setActiveTab(initialTab);
    setShowCloseConfirm(false);

    onOpenChange(false);
  };

  const clearSingleFile = () => {
    setFile(null);
    setPreview(null);
    setFraming(NO_FRAMING);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleCloseRequest}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{taggingBacklog ? tBulk('reviewTitle') : t('dialogTitle')}</DialogTitle>
          <DialogDescription>
            {taggingBacklog ? tBulk('reviewSubtitle') : t('description')}
          </DialogDescription>
        </DialogHeader>

        {/* The backlog pass is the screen you tag by hand on. Opening it with a
            card about the AI you do not have — and a button to go and buy some —
            pushes the actual work a third of a phone screen down for no reason. */}
        {noVisionAi && !taggingBacklog && (
          <AIUnavailableNotice feature="tagging" reason={aiStatus?.blocked_reason} />
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          {/* Three tabs have to fit a 320px phone at 125% font: let them
              shrink and ellipsize instead of pushing the dialog wider. */}
          <TabsList className="grid w-full grid-cols-3">
            {/* The label needs its own block for `truncate` to ellipsise it: a bare
                text node in a centred flex box just gets clipped at both ends,
                which at 320 px and 125 % font turns "Varias" into "aria". */}
            {(['single', 'link', 'bulk'] as const).map((tab) => (
              <TabsTrigger key={tab} value={tab} className="min-w-0 px-2 text-xs sm:px-4 sm:text-sm">
                <span className="min-w-0 truncate">
                  {t(tab === 'single' ? 'tabSingle' : tab === 'link' ? 'tabLink' : 'tabBulk')}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Paste a shop link: read on the server, reviewed here */}
          <TabsContent value="link" className="space-y-4">
            <LinkImportTab
              initialUrl={initial?.link ?? null}
              onCancel={handleCloseRequest}
              onUse={(prefill) => {
                if (prefill.file) {
                  setFile(prefill.file);
                  setFraming(NO_FRAMING);
                  const reader = new FileReader();
                  reader.onloadend = () => setPreview(reader.result as string);
                  reader.readAsDataURL(prefill.file);
                }
                if (prefill.name) setName(prefill.name.slice(0, 100));
                if (prefill.brand) setBrand(prefill.brand.slice(0, 100));
                if (prefill.primaryColor) {
                  setPrimaryColor(prefill.primaryColor);
                  // The shop only gave us a name, so there is no shade to show.
                  setPrimaryColorHex(undefined);
                }
                setSourceUrl(prefill.sourceUrl);
                setActiveTab(initialTab);
              }}
            />
          </TabsContent>

          {/* Single Item Upload */}
          <TabsContent value="single" className="space-y-4">
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              {!preview ? (
                <div
                  {...getSingleRootProps()}
                  data-testid="single-dropzone"
                  className={cn(
                    'rounded-lg border-2 border-dashed p-5 text-center transition-colors duration-150 sm:p-7',
                    isSingleDragActive
                      ? 'border-signature bg-signature-soft'
                      : 'border-border bg-panel'
                  )}
                >
                  <input {...getSingleInputProps()} data-testid="single-file-input" />
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-signature text-signature-foreground">
                    <Upload className="h-6 w-6" strokeWidth={1.75} />
                  </span>
                  <p className="mt-3 text-sm font-bold text-foreground">
                    {isSingleDragActive ? t('dragDropSingleActive') : t('dragDropSingle')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('acceptedFormats')}
                  </p>

                  {/* Taking the photo is the common case on a phone, so it is a
                      button of its own rather than something hidden behind the
                      gallery picker. Stacked and full width at 320 px so both stay
                      thumb-reachable; side by side once there is room. */}
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button type="button" onClick={openSinglePicker} className="w-full sm:w-auto">
                      <ImagePlus className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                      {t('choosePhoto')}
                    </Button>
                    {/* Its own input, because `capture` is what makes a phone open
                        the camera instead of the library — and a laptop with no
                        camera just falls back to the same file picker. */}
                    <Button asChild variant="secondary" className="w-full sm:w-auto">
                      <label className="cursor-pointer">
                        <Camera className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                        {t('takePhoto')}
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="sr-only"
                          data-testid="single-camera-input"
                          onChange={(event) => {
                            onDropSingle(Array.from(event.target.files ?? []));
                            event.target.value = '';
                          }}
                        />
                      </label>
                    </Button>
                  </div>

                  {noShareTarget && (
                    <p className="mt-3 text-xs text-muted-foreground">{tShare('iosHint')}</p>
                  )}
                </div>
              ) : (
                <PhotoPreview
                  src={preview}
                  framing={framing}
                  onFramingChange={setFraming}
                  onClear={clearSingleFile}
                />
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

                <div className="space-y-2">
                  <Label htmlFor="brand" className="font-bold">{t('brandLabel')}</Label>
                  <Input
                    id="brand"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder={t('brandPlaceholder')}
                  />
                </div>

                {/* Not a bare select any more: the colour is the one tag people get
                    wrong from a list and right by pointing at the garment. */}
                <div className="space-y-2">
                  <Label htmlFor="color" className="font-bold">{t('colorLabel')}</Label>
                  <ColorCaptureField
                    id="color"
                    value={primaryColor}
                    hex={primaryColorHex}
                    imageUrl={preview}
                    onPick={({ color, hex }) => {
                      setPrimaryColor(color);
                      setPrimaryColorHex(hex);
                    }}
                  />
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

          {/* Many photos at once: a queue with per-photo state and retry, and a
              quick review pass at the end. The queue itself lives above the
              router, so closing this dialog does not stop the upload. */}
          <TabsContent value="bulk" className="space-y-4">
            <BulkUploadPanel
              open={activeTab === 'bulk'}
              mode={bulkMode}
              onClose={handleClose}
            />
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
