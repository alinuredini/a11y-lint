import { Component } from '@angular/core';

@Component({
  selector: 'app-inline',
  standalone: true,
  template: `<img src="/a.png">
    <button (click)="save()"><svg aria-hidden="true"></svg></button>
    @if (open) {
      <div (click)="close()">Close</div>
    }`,
  styles: [`
    .x:focus { outline: none; }
  `],
})
export class InlineComponent {
  open = false;
  save() {}
  close() {}
}
