<script lang="ts">
  import 'todomvc-app-css/index.css'

  let { children } = $props()
</script>

<svelte:boundary>
  {#snippet pending()}
    <div>Loading LiveStore...</div>
  {/snippet}

  {@render children()}
</svelte:boundary>
