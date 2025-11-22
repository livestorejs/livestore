import 'todomvc-app-css/index.css'
import App from './App.svelte';
import { mount } from 'svelte';

mount(App, {
	target: document.querySelector('#root')!
});
