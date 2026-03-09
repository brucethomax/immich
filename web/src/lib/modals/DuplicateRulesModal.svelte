<script lang="ts">
  import { dragAndDrop } from '$lib/attachments/drag-and-drop.svelte';
  import {
    type DuplicateSelectionRule,
    type DuplicateSelectionRuleType,
    type RuleDirection,
    ruleDirectionLabels,
    ruleSupportsDirection,
    ruleTypeLabels,
  } from '$lib/utils/duplicate-utils';
  import { Button, Icon, Modal, ModalBody, Switch } from '@immich/ui';
  import { mdiChevronDown, mdiDragHorizontalVariant } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    onClose: (rules?: DuplicateSelectionRule[]) => void;
    rules: DuplicateSelectionRule[];
  }

  let { onClose, rules: propRules }: Props = $props();

  // Deep clone the incoming rules so modal edits don't mutate the caller's array.
  let rules = $state<DuplicateSelectionRule[]>(propRules.map((r) => ({ ...r })));

  // Drag-and-drop state
  let draggedIndex: number | null = $state(null);
  let dragOverIndex: number | null = $state(null);

  const handleDragStart = (index: number) => {
    draggedIndex = index;
  };

  const handleDragEnter = (index: number) => {
    if (draggedIndex !== null && draggedIndex !== index) {
      dragOverIndex = index;
    }
  };

  const handleDrop = (e: DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) {
      return;
    }
    const newRules = [...rules];
    const [draggedItem] = newRules.splice(draggedIndex, 1);
    newRules.splice(index, 0, draggedItem);
    rules = newRules;
  };

  const handleDragEnd = () => {
    draggedIndex = null;
    dragOverIndex = null;
  };

  const toggleEnabled = (index: number) => {
    rules[index].enabled = !rules[index].enabled;
    rules = [...rules];
  };

  const cycleDirection = (index: number) => {
    const current = rules[index].direction;
    const next: RuleDirection = current === 'desc' ? 'asc' : 'desc';
    rules[index] = { ...rules[index], direction: next };
    rules = [...rules];
  };

  const handleApply = () => {
    onClose(rules);
  };

  const handleCancel = () => {
    onClose();
  };

  const getDirectionLabel = (type: DuplicateSelectionRuleType, direction: RuleDirection): string => {
    return ruleDirectionLabels[type]?.[direction] ?? direction;
  };
</script>

<Modal title={$t('duplicate_selection_rules')} size="medium" onClose={handleCancel}>
  <ModalBody>
    <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
      {$t('duplicate_rules_description')}
    </p>

    <div class="flex flex-col gap-1">
      {#each rules as rule, index (rule.type)}
        <div
          {@attach dragAndDrop({
            index,
            onDragStart: handleDragStart,
            onDragEnter: handleDragEnter,
            onDrop: handleDrop,
            onDragEnd: handleDragEnd,
            isDragging: draggedIndex === index,
            isDragOver: dragOverIndex === index,
          })}
          class="flex items-center gap-2 rounded-lg px-3 py-2 transition-all cursor-grab active:cursor-grabbing border-2 border-transparent
            {rule.enabled ? 'bg-gray-50 dark:bg-gray-800/50' : 'opacity-50'}
            {draggedIndex === index ? 'opacity-50' : ''}
            {dragOverIndex === index ? 'border-primary/50 border-dashed' : ''}"
        >
          <!-- Drag handle -->
          <span class="shrink-0 text-gray-400 dark:text-gray-500">
            <Icon icon={mdiDragHorizontalVariant} size="18" />
          </span>

          <!-- Priority number -->
          <span class="text-xs font-mono text-gray-400 dark:text-gray-500 w-4 text-center shrink-0">
            {index + 1}
          </span>

          <!-- Toggle -->
          <div class="shrink-0">
            <Switch checked={rule.enabled} onCheckedChange={() => toggleEnabled(index)} />
          </div>

          <!-- Rule name -->
          <span class="text-sm font-medium dark:text-white flex-1 truncate">
            {ruleTypeLabels[rule.type]}
          </span>

          <!-- Direction toggle (if supported) -->
          {#if ruleSupportsDirection[rule.type]}
            <button
              type="button"
              class="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors shrink-0
                {rule.enabled
                ? 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}"
              onclick={() => cycleDirection(index)}
              disabled={!rule.enabled}
            >
              {getDirectionLabel(rule.type, rule.direction)}
              <Icon icon={mdiChevronDown} size="14" />
            </button>
          {:else}
            <span
              class="text-xs shrink-0
                {rule.enabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-300 dark:text-gray-600'}"
            >
              {getDirectionLabel(rule.type, rule.direction)}
            </span>
          {/if}
        </div>
      {/each}
    </div>

    <div class="flex justify-end gap-2 mt-6">
      <Button size="small" color="secondary" variant="ghost" onclick={handleCancel}>
        {$t('cancel')}
      </Button>
      <Button size="small" color="primary" onclick={handleApply}>
        {$t('apply')}
      </Button>
    </div>
  </ModalBody>
</Modal>
