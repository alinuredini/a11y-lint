<script lang="ts">
  let { items, label }: { items: string[]; label: string } = $props();
</script>

<div class="card">
  <img src="/hero.png" />
  <div onclick={() => alert('hi')}>Open</div>
  <input type="text" placeholder="Search" />
  <button><svg aria-hidden="true" /></button>
  <a href="/docs">click here</a>
  <label for="email">Email</label>
  <input id="email" type="email" autocomplete="email" />
  <button>{label}</button>
  <span tabindex="2">focus me</span>
  <p class="text-gray-400 bg-white">Low contrast</p>
  {#each items as i}
    <img src={i} alt="" />
  {/each}
</div>
