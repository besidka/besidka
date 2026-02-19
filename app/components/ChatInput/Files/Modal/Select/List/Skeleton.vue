<template>
  <table class="table table-xs">
    <thead>
      <tr>
        <th class="w-8">
          <div class="skeleton size-4 rounded" />
        </th>
        <th class="w-10" />
        <th>Name</th>
        <th class="w-20 hidden sm:table-cell">Type</th>
        <th class="w-20 hidden sm:table-cell">Size</th>
        <th class="w-20">Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="i in 6" :key="i">
        <td>
          <div class="skeleton size-4 rounded" />
        </td>
        <td>
          <div class="skeleton size-8 rounded-sm" />
        </td>
        <td>
          <div class="skeleton h-4 w-24" />
        </td>
        <td class="hidden sm:table-cell">
          <div class="skeleton h-3 w-12" />
        </td>
        <td class="hidden sm:table-cell">
          <div class="skeleton h-3 w-14" />
        </td>
        <td>
          <div class="flex gap-0.5">
            <div class="skeleton size-6 rounded-full" />
            <div class="skeleton size-6 rounded-full" />
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</template>
