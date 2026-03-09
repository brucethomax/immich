<script lang="ts">
  import { Button, Modal, ModalBody, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';

  export type DeduplicateChoice = 'cancel' | 'reviewed' | 'all';

  interface Props {
    onClose: (choice?: DeduplicateChoice) => void;
    totalCount: number;
    reviewedCount: number;
    totalTrashCount: number;
    reviewedTrashCount: number;
  }

  let { onClose, totalCount, reviewedCount, totalTrashCount, reviewedTrashCount }: Props = $props();
</script>

<Modal title={$t('deduplicate_all')} size="small" onClose={() => onClose()}>
  <ModalBody>
    <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
      Choose which duplicate groups to resolve. Reviewed groups are those you have viewed and accepted.
    </p>

    <div class="flex flex-col gap-3">
      <Button size="small" color="primary" onclick={() => onClose('reviewed')} disabled={reviewedCount === 0}>
        <div class="flex flex-col items-start w-full py-1">
          <Text fontWeight="semi-bold">Reviewed only ({reviewedCount} groups)</Text>
          <span class="text-xs text-black">
            {reviewedTrashCount} {reviewedTrashCount === 1 ? 'asset' : 'assets'} will be trashed
          </span>
        </div>
      </Button>

      <Button size="small" color="danger" onclick={() => onClose('all')}>
        <div class="flex flex-col items-start w-full py-1">
          <Text fontWeight="semi-bold">All ({totalCount} groups)</Text>
          <span class="text-xs text-black">
            {totalTrashCount} {totalTrashCount === 1 ? 'asset' : 'assets'} will be trashed
          </span>
        </div>
      </Button>

      <Button size="small" color="secondary" variant="ghost" onclick={() => onClose()}>
        {$t('cancel')}
      </Button>
    </div>
  </ModalBody>
</Modal>
