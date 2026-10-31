<template>
  <div class="card">
    <img src="/hero.png" />
    <div @click="open">Open</div>
    <input type="text" placeholder="Search" />
    <button><svg aria-hidden="true" /></button>
    <a href="/docs">click here</a>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="email" />
    <button>{{ label }}</button>
    <span tabindex="2">focus me</span>
    <p class="text-gray-400 bg-white">Low contrast</p>
    <img v-for="i in items" :key="i" :src="i" alt="" />
    <router-link to="/home"></router-link>
  </div>
</template>

<script setup lang="ts">
defineProps<{ items: string[]; label: string }>();
const open = () => alert('hi');
</script>

<style scoped>
.card button:focus { outline: none; }
</style>
