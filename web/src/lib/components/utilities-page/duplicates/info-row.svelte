<script lang="ts">
  import { Icon, Text } from '@immich/ui';
  import { mdiCheckBold, mdiCloseThick } from '@mdi/js';
  import type { Snippet } from 'svelte';

  interface Props {
    icon: string;
    children?: Snippet;
    rawContent?: Snippet;
    borderBottom?: boolean;
    highlight?: boolean;
    title?: string;
    /** undefined = no indicator, true = passed rule, false = failed rule */
    rulePass?: boolean;
  }

  let { icon, children, rawContent, borderBottom = true, highlight = false, title, rulePass }: Props = $props();
</script>

<div class="grid grid-cols-[25px_1fr] w-full px-1 py-0.5" class:border-b={borderBottom} {title}>
  <div class="flex items-center gap-0.5">
    <Icon {icon} size="18" class="text-dark/25 {highlight ? 'text-primary/75' : ''}" />
    {#if rulePass === true}
      <Icon icon={mdiCheckBold} size="18" class="text-green-500" />
    {:else if rulePass === false}
      <Icon icon={mdiCloseThick} size="18" class="text-red-400" />
    {/if}
  </div>
  <div class="justify-self-end text-end rounded px-1 transition-colors w-full overflow-hidden">
    {#if rawContent}
      <span class="text-xs {highlight ? 'text-primary' : ''} text-ellipsis overflow-hidden">
        {@render rawContent()}
      </span>
    {:else}
      <Text
        size="tiny"
        fontWeight={highlight ? 'semi-bold' : 'normal'}
        class={`${highlight ? 'text-primary' : ''} text-ellipsis w-full overflow-hidden`}
      >
        {@render children?.()}
      </Text>
    {/if}
  </div>
</div>
