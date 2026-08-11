const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let x = 100;
let y = 100;
const size = 50;
const speed = 10;

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "blue";
  ctx.fillRect(x, y, size, size);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp") {
    y -= speed;
  }

  if (event.key === "ArrowDown") {
    y += speed;
  }

  if (event.key === "ArrowLeft") {
    x -= speed;
  }

  if (event.key === "ArrowRight") {
    x += speed;
  }

  draw();
});

draw();