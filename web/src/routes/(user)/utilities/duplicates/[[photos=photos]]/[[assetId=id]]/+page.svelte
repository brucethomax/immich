<script lang="ts">
  import { afterNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { shortcuts } from '$lib/actions/shortcut';
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import DuplicatesCompareControl from '$lib/components/utilities-page/duplicates/duplicates-compare-control.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import DeduplicateConfirmModal from '$lib/modals/DeduplicateConfirmModal.svelte';
  import DuplicateRulesModal from '$lib/modals/DuplicateRulesModal.svelte';
  import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
  import { Route } from '$lib/route';
  import { assetViewingStore } from '$lib/stores/asset-viewing.store';
  import { locale, savedDuplicateRules } from '$lib/stores/preferences.store';
  import { stackAssets } from '$lib/utils/asset-utils';
  import { getByteUnitString } from '$lib/utils/byte-units';
  import {
    type DuplicateSelectionRule,
    getDefaultDuplicateRules,
    rankDuplicates,
    suggestDuplicate,
  } from '$lib/utils/duplicate-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { fromISODateTime, fromISODateTimeUTC } from '$lib/utils/timeline-util';
  import type { AssetResponseDto } from '@immich/sdk';
  import { deleteAssets, deleteDuplicates, updateAssets } from '@immich/sdk';
  import { Button, HStack, Icon, IconButton, modalManager, Text, toastManager } from '@immich/ui';
  import {
    mdiCheckBold,
    mdiCheckOutline,
    mdiChevronDown,
    mdiChevronLeft,
    mdiChevronRight,
    mdiKeyboard,
    mdiListStatus,
    mdiPageFirst,
    mdiPageLast,
    mdiRefresh,
    mdiTrashCanOutline,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }

  let { data = $bindable() }: Props = $props();

  let compareScrollDiv: HTMLElement | undefined;

  afterNavigate(() => {
    compareScrollDiv?.scrollTo({ top: 0, behavior: 'instant' });
  });

  interface Shortcuts {
    general: ExplainedShortcut[];
    actions: ExplainedShortcut[];
  }
  interface ExplainedShortcut {
    key: string[];
    action: string;
    info?: string;
  }

  const duplicateShortcuts: Shortcuts = {
    general: [],
    actions: [
      { key: ['a'], action: $t('select_all_duplicates') },
      { key: ['s'], action: $t('view') },
      { key: ['d'], action: $t('unselect_all_duplicates') },
      { key: ['⇧', 'c'], action: $t('resolve_duplicates') },
      { key: ['⇧', 's'], action: $t('stack_duplicates') },
    ],
  };

  let duplicates = $state(data.duplicates);
  const { isViewing: showAssetViewer } = assetViewingStore;

  // Duplicate selection rules — restore from localStorage if previously saved
  let duplicateRules = $state<DuplicateSelectionRule[]>($savedDuplicateRules ?? getDefaultDuplicateRules());

  // Track whether rules have been changed from defaults
  let hasRuleChanges = $state($savedDuplicateRules !== null);

  // Global state: map of duplicateId -> SvelteSet of keeper asset IDs
  let groupSelections = new SvelteMap<string, SvelteSet<string>>();

  // Snapshot of initial selections to detect manual changes
  let initialSelections = new SvelteMap<string, Set<string>>();

  // Track which groups the user has viewed/accepted
  let reviewedGroups = new SvelteSet<string>();

  // Detect if user has manually changed any selections or rules
  let hasManualEdits = $derived(
    hasRuleChanges ||
    (() => {
      for (const [duplicateId, keepers] of groupSelections) {
        const initial = initialSelections.get(duplicateId);
        if (!initial) {
          return true;
        }
        if (keepers.size !== initial.size) {
          return true;
        }
        for (const id of keepers) {
          if (!initial.has(id)) {
            return true;
          }
        }
      }
      return false;
    })(),
  );

  // Initialize keeper selections for all groups using suggestDuplicate
  const initializeSelections = () => {
    groupSelections.clear();
    initialSelections.clear();
    for (const group of duplicates) {
      const suggested = suggestDuplicate(group.assets, duplicateRules);
      const keeperIds = new SvelteSet<string>();
      if (suggested) {
        keeperIds.add(suggested.id);
      } else if (group.assets.length > 0) {
        keeperIds.add(group.assets[0].id);
      }
      groupSelections.set(group.duplicateId, keeperIds);
      initialSelections.set(group.duplicateId, new Set(keeperIds));
    }
  };

  // Initialize on load
  initializeSelections();

  // Helper to get the keeper set for a given group
  const getGroupKeepers = (duplicateId: string): SvelteSet<string> => {
    let keepers = groupSelections.get(duplicateId);
    if (!keepers) {
      keepers = new SvelteSet<string>();
      groupSelections.set(duplicateId, keepers);
    }
    return keepers;
  };

  // Derive sidebar info for each group
  const getKeeperAsset = (group: (typeof duplicates)[number]): AssetResponseDto | undefined => {
    const keepers = groupSelections.get(group.duplicateId);
    if (keepers && keepers.size > 0) {
      const firstKeeperId = [...keepers][0];
      return group.assets.find((a) => a.id === firstKeeperId);
    }
    return suggestDuplicate(group.assets, duplicateRules) ?? group.assets[0];
  };

  const getKeeperFilename = (group: (typeof duplicates)[number]): string => {
    return getKeeperAsset(group)?.originalFileName ?? 'Unknown';
  };

  const getKeeperDate = (asset: AssetResponseDto | undefined): string => {
    if (!asset) {
      return '';
    }
    const tz = asset.exifInfo?.timeZone;
    const dt =
      tz && asset.exifInfo?.dateTimeOriginal
        ? fromISODateTime(asset.exifInfo.dateTimeOriginal, tz)
        : fromISODateTimeUTC(asset.localDateTime);
    return (
      dt?.toLocaleString(
        { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
        { locale: $locale },
      ) ?? ''
    );
  };

  // Sort
  type SortOption =
    | 'size-desc'
    | 'size-asc'
    | 'total-size'
    | 'name-asc'
    | 'name-desc'
    | 'date-asc'
    | 'date-desc'
    | 'upload-asc'
    | 'upload-desc'
    | 'count';

  const sortLabels: Record<SortOption, string> = {
    'size-desc': 'Size: Large to Small',
    'size-asc': 'Size: Small to Large',
    'total-size': 'Total Size (Large to Small)',
    'name-asc': 'Name: A to Z',
    'name-desc': 'Name: Z to A',
    'date-asc': 'Date Taken: Oldest to Newest',
    'date-desc': 'Date Taken: Newest to Oldest',
    'upload-asc': 'Upload: Oldest to Newest',
    'upload-desc': 'Upload: Newest to Oldest',
    count: 'Count',
  };

  const validSortOptions = new Set<string>(Object.keys(sortLabels));
  const sortParam = page.url.searchParams.get('sortBy');
  let sortBy = $state<SortOption>(validSortOptions.has(sortParam ?? '') ? (sortParam as SortOption) : 'date-desc');
  let showSortMenu = $state(false);

  const getKeeperFileSize = (group: (typeof duplicates)[number]): number => {
    const asset = getKeeperAsset(group);
    return asset?.exifInfo?.fileSizeInByte ?? 0;
  };

  const getTotalGroupSize = (group: (typeof duplicates)[number]): number => {
    return group.assets.reduce((sum, a) => sum + (a.exifInfo?.fileSizeInByte ?? 0), 0);
  };

  const getKeeperDateValue = (group: (typeof duplicates)[number]): number => {
    const asset = getKeeperAsset(group);
    if (!asset) {
      return 0;
    }
    const dateStr = asset.exifInfo?.dateTimeOriginal ?? asset.localDateTime;
    return dateStr ? new Date(dateStr).getTime() : 0;
  };

  const getKeeperUploadDateValue = (group: (typeof duplicates)[number]): number => {
    const asset = getKeeperAsset(group);
    if (!asset) {
      return 0;
    }
    return asset.fileCreatedAt ? new Date(asset.fileCreatedAt).getTime() : 0;
  };

  let sortedDuplicateIndices = $derived(
    (() => {
      const indices = duplicates.map((_, i) => i);
      switch (sortBy) {
        case 'size-desc': {
          return indices.sort((a, b) => getKeeperFileSize(duplicates[b]) - getKeeperFileSize(duplicates[a]));
        }
        case 'size-asc': {
          return indices.sort((a, b) => getKeeperFileSize(duplicates[a]) - getKeeperFileSize(duplicates[b]));
        }
        case 'total-size': {
          return indices.sort((a, b) => getTotalGroupSize(duplicates[b]) - getTotalGroupSize(duplicates[a]));
        }
        case 'name-asc': {
          return indices.sort((a, b) =>
            getKeeperFilename(duplicates[a]).localeCompare(getKeeperFilename(duplicates[b])),
          );
        }
        case 'name-desc': {
          return indices.sort((a, b) =>
            getKeeperFilename(duplicates[b]).localeCompare(getKeeperFilename(duplicates[a])),
          );
        }
        case 'date-asc': {
          return indices.sort((a, b) => getKeeperDateValue(duplicates[a]) - getKeeperDateValue(duplicates[b]));
        }
        case 'date-desc': {
          return indices.sort((a, b) => getKeeperDateValue(duplicates[b]) - getKeeperDateValue(duplicates[a]));
        }
        case 'upload-asc': {
          return indices.sort((a, b) => getKeeperUploadDateValue(duplicates[a]) - getKeeperUploadDateValue(duplicates[b]));
        }
        case 'upload-desc': {
          return indices.sort((a, b) => getKeeperUploadDateValue(duplicates[b]) - getKeeperUploadDateValue(duplicates[a]));
        }
        case 'count': {
          return indices.sort((a, b) => duplicates[b].assets.length - duplicates[a].assets.length);
        }
        default: {
          return indices;
        }
      }
    })(),
  );

  // Selected group from URL param
  let selectedGroupId = $derived(page.url.searchParams.get('groupId'));

  let selectedGroupIndex = $derived(
    selectedGroupId ? duplicates.findIndex((d) => d.duplicateId === selectedGroupId) : -1,
  );

  let selectedGroup = $derived(selectedGroupIndex >= 0 ? duplicates[selectedGroupIndex] : undefined);

  // Position of selected group within the sorted list
  let sortedPosition = $derived(selectedGroupIndex >= 0 ? sortedDuplicateIndices.indexOf(selectedGroupIndex) : -1);

  let hasDuplicates = $derived(duplicates.length > 0);

  let totalTrashedSize = $derived(
    (() => {
      let total = 0;
      for (const group of duplicates) {
        const keepers = groupSelections.get(group.duplicateId);
        for (const asset of group.assets) {
          if (!keepers?.has(asset.id)) {
            total += asset.exifInfo?.fileSizeInByte ?? 0;
          }
        }
      }
      return total;
    })(),
  );

  let reviewedTrashedSize = $derived(
    (() => {
      let total = 0;
      for (const group of duplicates) {
        if (!reviewedGroups.has(group.duplicateId)) {
          continue;
        }
        const keepers = groupSelections.get(group.duplicateId);
        for (const asset of group.assets) {
          if (!keepers?.has(asset.id)) {
            total += asset.exifInfo?.fileSizeInByte ?? 0;
          }
        }
      }
      return total;
    })(),
  );
  const withConfirmation = async (callback: () => Promise<void>, prompt?: string, confirmText?: string) => {
    if (prompt && confirmText) {
      const isConfirmed = await modalManager.showDialog({ prompt, confirmText });
      if (!isConfirmed) {
        return;
      }
    }

    try {
      return await callback();
    } catch (error) {
      handleError(error, $t('errors.unable_to_resolve_duplicate'));
    }
  };

  const deletedNotification = (trashedCount: number) => {
    if (!trashedCount) {
      return;
    }

    const message = featureFlagsManager.value.trash
      ? $t('assets_moved_to_trash_count', { values: { count: trashedCount } })
      : $t('permanently_deleted_assets_count', { values: { count: trashedCount } });
    toastManager.success(message);
  };

  const handleResolve = async (duplicateId: string, duplicateAssetIds: string[], trashIds: string[]) => {
    return withConfirmation(
      async () => {
        await deleteAssets({ assetBulkDeleteDto: { ids: trashIds, force: !featureFlagsManager.value.trash } });
        await updateAssets({ assetBulkUpdateDto: { ids: duplicateAssetIds, duplicateId: null } });

        duplicates = duplicates.filter((duplicate) => duplicate.duplicateId !== duplicateId);
        groupSelections.delete(duplicateId);
        reviewedGroups.delete(duplicateId);

        deletedNotification(trashIds.length);
        await navigateToNextGroup();
      },
      trashIds.length > 0 && !featureFlagsManager.value.trash ? $t('delete_duplicates_confirmation') : undefined,
      trashIds.length > 0 && !featureFlagsManager.value.trash ? $t('permanently_delete') : undefined,
    );
  };

  const handleStack = async (duplicateId: string, assets: AssetResponseDto[]) => {
    await stackAssets(assets, false);
    const duplicateAssetIds = assets.map((asset) => asset.id);
    await updateAssets({ assetBulkUpdateDto: { ids: duplicateAssetIds, duplicateId: null } });
    duplicates = duplicates.filter((duplicate) => duplicate.duplicateId !== duplicateId);
    groupSelections.delete(duplicateId);
    reviewedGroups.delete(duplicateId);
    await navigateToNextGroup();
  };

  const handleDeduplicateAll = async () => {
    // Mark the currently viewed group as reviewed before showing dialog
    if (selectedGroup) {
      reviewedGroups.add(selectedGroup.duplicateId);
    }

    const reviewedDuplicates = duplicates.filter((g) => reviewedGroups.has(g.duplicateId));

    // Count trash for each scope
    const countTrash = (groups: typeof duplicates) => {
      let count = 0;
      for (const group of groups) {
        const keepers = groupSelections.get(group.duplicateId);
        for (const asset of group.assets) {
          if (!keepers?.has(asset.id)) {
            count++;
          }
        }
      }
      return count;
    };

    const choice = await modalManager.show(DeduplicateConfirmModal, {
      totalCount: duplicates.length,
      reviewedCount: reviewedDuplicates.length,
      totalTrashCount: countTrash(duplicates),
      reviewedTrashCount: countTrash(reviewedDuplicates),
    });

    if (!choice || choice === 'cancel') {
      return;
    }

    const targetGroups = choice === 'reviewed' ? reviewedDuplicates : duplicates;

    const idsToKeep: string[] = [];
    const idsToDelete: string[] = [];

    for (const group of targetGroups) {
      const keepers = groupSelections.get(group.duplicateId);
      for (const asset of group.assets) {
        if (keepers?.has(asset.id)) {
          idsToKeep.push(asset.id);
        } else {
          idsToDelete.push(asset.id);
        }
      }
    }

    return withConfirmation(
      async () => {
        await deleteAssets({ assetBulkDeleteDto: { ids: idsToDelete, force: !featureFlagsManager.value.trash } });
        await updateAssets({
          assetBulkUpdateDto: {
            ids: [...idsToDelete, ...idsToKeep],
            duplicateId: null,
          },
        });

        const resolvedIds = new Set(targetGroups.map((g) => g.duplicateId));
        duplicates = duplicates.filter((d) => !resolvedIds.has(d.duplicateId));
        for (const id of resolvedIds) {
          groupSelections.delete(id);
          reviewedGroups.delete(id);
        }

        deletedNotification(idsToDelete.length);

        // Clear selection after bulk deduplication
        await goto(Route.duplicatesUtility({ sortBy }));
      },
      idsToDelete.length > 0 && !featureFlagsManager.value.trash ? $t('delete_duplicates_confirmation') : undefined,
      idsToDelete.length > 0 && !featureFlagsManager.value.trash ? $t('permanently_delete') : undefined,
    );
  };

  const handleKeepAll = async () => {
    const ids = duplicates.map(({ duplicateId }) => duplicateId);
    return withConfirmation(
      async () => {
        await deleteDuplicates({ bulkIdsDto: { ids } });

        duplicates = [];

        toastManager.success($t('resolved_all_duplicates'));
        await goto(Route.duplicatesUtility());
      },
      $t('bulk_keep_duplicates_confirmation', { values: { count: ids.length } }),
      $t('confirm'),
    );
  };

  const handleReselectDuplicates = async () => {
    if (hasManualEdits) {
      const isConfirmed = await modalManager.showDialog({
        prompt: $t('reselect_duplicates_confirmation'),
        confirmText: $t('confirm'),
      });
      if (!isConfirmed) {
        return;
      }
    }
    duplicateRules = getDefaultDuplicateRules();
    hasRuleChanges = false;
    $savedDuplicateRules = null;
    initializeSelections();
  };

  const handleOpenRulesModal = async () => {
    const result = await modalManager.show(DuplicateRulesModal, { rules: duplicateRules });
    if (result) {
      duplicateRules = result;
      hasRuleChanges = true;
      $savedDuplicateRules = result;
      initializeSelections();
    }
  };

  const navigateToGroup = async (duplicateId: string) => {
    // Mark the current group as reviewed before navigating away
    if (selectedGroup) {
      reviewedGroups.add(selectedGroup.duplicateId);
    }
    return goto(Route.duplicatesUtility({ groupId: duplicateId, sortBy }));
  };

  const navigateToNextGroup = async () => {
    if (duplicates.length === 0) {
      return goto(Route.duplicatesUtility({ sortBy }));
    }
    // Stay at the same sorted position (or last if we were at the end)
    const nextPos = Math.min(sortedPosition, sortedDuplicateIndices.length - 1);
    const nextIndex = sortedDuplicateIndices[Math.max(0, nextPos)];
    return goto(Route.duplicatesUtility({ groupId: duplicates[nextIndex].duplicateId, sortBy }));
  };

  const handleFirst = () => navigateToGroup(duplicates[sortedDuplicateIndices[0]].duplicateId);
  const handlePrevious = async () => {
    const prev = Math.max(sortedPosition - 1, 0);
    await navigateToGroup(duplicates[sortedDuplicateIndices[prev]].duplicateId);
  };
  const handlePreviousShortcut = async () => {
    if ($showAssetViewer) {
      return;
    }
    await handlePrevious();
  };
  const handleNext = async () => {
    const next = Math.min(sortedPosition + 1, sortedDuplicateIndices.length - 1);
    await navigateToGroup(duplicates[sortedDuplicateIndices[next]].duplicateId);
  };
  const handleNextShortcut = async () => {
    if ($showAssetViewer) {
      return;
    }
    await handleNext();
  };
  const handleLast = async () => {
    const lastIndex = sortedDuplicateIndices.at(-1)!;
    await navigateToGroup(duplicates[lastIndex].duplicateId);
  };

  // Scroll the active sidebar item into view when the selection changes
  $effect(() => {
    if (!selectedGroupId) {
      return;
    }
    const sidebar = document.querySelector('#duplicates-sidebar');
    const active = sidebar?.querySelector(`[data-group-id="${CSS.escape(selectedGroupId)}"]`);
    active?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
</script>

<svelte:document
  use:shortcuts={[
    { shortcut: { key: 'ArrowLeft' }, onShortcut: handlePreviousShortcut },
    { shortcut: { key: 'ArrowRight' }, onShortcut: handleNextShortcut },
  ]}
/>

<UserPageLayout
  title={
    data.meta.title +
    ` (${duplicates.length.toLocaleString($locale)})` +
    (totalTrashedSize > 0
      ? ` — ${getByteUnitString(totalTrashedSize, $locale)} to trash` +
        (reviewedTrashedSize > 0 ? ` (${getByteUnitString(reviewedTrashedSize, $locale)} reviewed)` : '')
      : '')
  }
  scrollbar={true}
>
  {#snippet buttons()}
    <HStack gap={0}>
      <Button
        leadingIcon={mdiRefresh}
        onclick={() => handleReselectDuplicates()}
        disabled={!hasDuplicates || !hasManualEdits}
        size="small"
        variant="ghost"
        color="secondary"
      >
        <Text class="hidden md:block">{$t('reselect')}</Text>
      </Button>
      <Button
        leadingIcon={mdiTrashCanOutline}
        onclick={() => handleDeduplicateAll()}
        disabled={!hasDuplicates}
        size="small"
        variant="ghost"
        color="secondary"
      >
        <Text class="hidden md:block">{$t('deduplicate_all')}</Text>
      </Button>
      <Button
        leadingIcon={mdiCheckOutline}
        onclick={() => handleKeepAll()}
        disabled={!hasDuplicates}
        size="small"
        variant="ghost"
        color="secondary"
      >
        <Text class="hidden md:block">{$t('keep_all')}</Text>
      </Button>
      <IconButton
        shape="round"
        variant="ghost"
        color="secondary"
        icon={mdiListStatus}
        title={$t('duplicate_selection_rules')}
        onclick={() => handleOpenRulesModal()}
        aria-label={$t('duplicate_selection_rules')}
      />
      <IconButton
        shape="round"
        variant="ghost"
        color="secondary"
        icon={mdiKeyboard}
        title={$t('show_keyboard_shortcuts')}
        onclick={() => modalManager.show(ShortcutsModal, { shortcuts: duplicateShortcuts })}
        aria-label={$t('show_keyboard_shortcuts')}
      />
    </HStack>
  {/snippet}

  <div class="">
    {#if duplicates && duplicates.length > 0}
      <div class="flex gap-4" style="height: calc(100vh - 14rem);">
        <!-- Sidebar: duplicate groups list -->
        <div class="w-72 shrink-0 flex flex-col rounded-2xl border dark:border-gray-700 bg-white dark:bg-gray-900">
          <div class="flex items-center justify-between p-2 border-b dark:border-gray-700">
            <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              {$t('duplicates')} ({duplicates.length.toLocaleString($locale)})
              {#if reviewedGroups.size > 0}
                <span class="text-green-500 normal-case">· {reviewedGroups.size} reviewed</span>
              {/if}
            </span>
            <div class="relative">
              <button
                type="button"
                class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-1.5 py-0.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                onclick={() => (showSortMenu = !showSortMenu)}
              >
                {sortLabels[sortBy]}
                <Icon icon={mdiChevronDown} size="16" />
              </button>
              {#if showSortMenu}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-40"
                  onmouseleave={() => (showSortMenu = false)}
                >
                  {#each Object.entries(sortLabels) as [value, label] (value)}
                    <button
                      type="button"
                      class="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors
                        {sortBy === value ? 'font-semibold text-primary' : 'text-gray-700 dark:text-gray-300'}"
                      onclick={async () => {
                        sortBy = value as SortOption;
                        showSortMenu = false;
                        await goto(Route.duplicatesUtility({ groupId: selectedGroupId ?? undefined, sortBy: value }), { replaceState: true });
                      }}
                    >
                      {sortBy === value ? '\u2713 ' : ''}{label}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
          <div class="flex flex-col overflow-y-auto flex-1" id="duplicates-sidebar">
            {#each sortedDuplicateIndices as originalIndex (duplicates[originalIndex].duplicateId)}
              {@const group = duplicates[originalIndex]}
              {@const keepers = groupSelections.get(group.duplicateId)}
              {@const keepCount = keepers?.size ?? 0}
              {@const totalCount = group.assets.length}
              {@const keeperFilename = getKeeperFilename(group)}
              {@const keeperAsset = getKeeperAsset(group)}
              {@const groupTotalSize = sortBy === 'total-size' ? getTotalGroupSize(group) : 0}
              {@const isReviewed = reviewedGroups.has(group.duplicateId)}
              <button
                type="button"
                data-group-id={group.duplicateId}
                class="flex flex-col gap-1 px-3 py-2 text-left text-sm border-b dark:border-gray-700/50 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800
                  {group.duplicateId === selectedGroupId
                  ? 'bg-primary/10 dark:bg-primary/20 border-l-2 border-l-primary'
                  : isReviewed
                    ? 'border-l-2 border-l-green-500/50'
                    : ''}"
                onclick={() => navigateToGroup(group.duplicateId)}
              >
                <span class="font-medium truncate dark:text-white" title={keeperFilename}>
                  {keeperFilename}
                </span>
                <div class="flex items-center gap-2">
                  <span
                    class="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-gray-800 rounded-full px-2 py-0.5
                      {isReviewed ? 'text-green-600 dark:text-green-400 font-bold' : 'text-gray-600 dark:text-gray-400'}"
                  >
                    <Icon icon={isReviewed ? mdiCheckBold : mdiCheckOutline} size="12" />
                    {keepCount} | {totalCount}
                  </span>
                  {#if sortBy === 'total-size'}
                    <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {getByteUnitString(groupTotalSize, $locale)}
                    </span>
                  {:else if sortBy === 'size-desc' || sortBy === 'size-asc'}
                    <span class="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {getByteUnitString(keeperAsset?.exifInfo?.fileSizeInByte ?? 0, $locale)}
                    </span>
                  {:else}
                    <span class="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {getKeeperDate(keeperAsset)}
                    </span>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        </div>

        <!-- Main content: compare view -->
        <div class="flex-1 overflow-y-auto" bind:this={compareScrollDiv}>
          {#if selectedGroup}
          {#key selectedGroup.duplicateId}
            <DuplicatesCompareControl
              assets={rankDuplicates(selectedGroup.assets, duplicateRules)}
              selectedAssetIds={getGroupKeepers(selectedGroup.duplicateId)}
              rules={duplicateRules}
              onResolve={(duplicateAssetIds, trashIds) =>
                handleResolve(selectedGroup.duplicateId, duplicateAssetIds, trashIds)}
              onStack={(assets) => handleStack(selectedGroup.duplicateId, assets)}
            />
            <div class="max-w-5xl mx-auto mb-16">
              <div
                class="flex mb-4 sm:px-6 w-full place-content-center justify-between items-center place-items-center"
              >
                <div class="flex text-xs text-black">
                  <Button
                    size="small"
                    leadingIcon={mdiPageFirst}
                    color="primary"
                    class="flex place-items-center rounded-s-full gap-2 px-2 sm:px-4"
                    onclick={handleFirst}
                    disabled={sortedPosition <= 0}
                  >
                    {$t('first')}
                  </Button>
                  <Button
                    size="small"
                    leadingIcon={mdiChevronLeft}
                    color="primary"
                    class="flex place-items-center rounded-e-full gap-2 px-2 sm:px-4"
                    onclick={handlePrevious}
                    disabled={sortedPosition <= 0}
                  >
                    {$t('previous')}
                  </Button>
                </div>
                <p class="border px-3 md:px-6 py-1 dark:bg-subtle rounded-lg text-xs md:text-sm">
                  {sortedPosition + 1} / {duplicates.length.toLocaleString($locale)}
                </p>
                <div class="flex text-xs text-black">
                  <Button
                    size="small"
                    trailingIcon={mdiChevronRight}
                    color="primary"
                    class="flex place-items-center rounded-s-full gap-2 px-2 sm:px-4"
                    onclick={handleNext}
                    disabled={sortedPosition >= sortedDuplicateIndices.length - 1}
                  >
                    {$t('next')}
                  </Button>
                  <Button
                    size="small"
                    trailingIcon={mdiPageLast}
                    color="primary"
                    class="flex place-items-center rounded-e-full gap-2 px-2 sm:px-4"
                    onclick={handleLast}
                    disabled={sortedPosition >= sortedDuplicateIndices.length - 1}
                  >
                    {$t('last')}
                  </Button>
                </div>
              </div>
            </div>
          {/key}
          {:else}
            <p class="text-center text-sm text-gray-500 dark:text-gray-400 mt-12">
              Select a duplicate group to compare
            </p>
          {/if}
        </div>
      </div>
    {:else}
      <p class="text-center text-lg dark:text-white flex place-items-center place-content-center">
        {$t('no_duplicates_found')}
      </p>
    {/if}
  </div>
</UserPageLayout>
