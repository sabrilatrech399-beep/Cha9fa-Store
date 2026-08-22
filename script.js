const products = [
  {
    id: 1,
    name: "100 جواهر",
    price: 300,
    icon: "images/diamond.png"
  },
  {
    id: 2,
    name: "300 جواهر",
    price: 900,
    icon: "images/diamond.png"
  },
  {
    id: 3,
    name: "500 جواهر",
    price: 1500,
    icon: "images/diamond.png"
  },
  {
    id: 4,
    name: "1000 جواهر",
    price: 3000,
    icon: "images/diamond.png"
  }
];

let cart = [];

const grid = document.getElementById("productsGrid");
const search = document.getElementById("search");

function render(list = products) {
  grid.innerHTML = list.map(p => `
    <article class="card">
      <div class="product-img">
        <img src="${p.icon}" alt="${p.name}">
      </div>

      <h3>${p.name}</h3>

      <div class="price">
        ${p.price.toLocaleString()} نقطة
      </div>

      <button class="add" onclick="addToCart(${p.id})">
        أضف إلى السلة
      </button>
    </article>
  `).join("");
}

function addToCart(id) {
  const product = products.find(p => p.id === id);

  if (product) {
    cart.push(product);
    updateCart();
  }
}

function updateCart() {
  document.getElementById("cartCount").textContent = cart.length;

  document.getElementById("cartItems").innerHTML =
    cart.length
      ? cart.map((p, i) => `
          <div class="cart-item">
            <span>${p.name}</span>
            <span>
              ${p.price.toLocaleString()} نقطة
              <button onclick="removeItem(${i})">✕</button>
            </span>
          </div>
        `).join("")
      : "<p style='color:#9ca3af'>السلة فارغة.</p>";

  const total = cart.reduce((sum, p) => sum + p.price, 0);

  document.getElementById("cartTotal").textContent =
    total.toLocaleString() + " نقطة";
}

function removeItem(i) {
  cart.splice(i, 1);
  updateCart();
}

function openCart() {
  document.getElementById("cartPanel").classList.add("open");
  document.getElementById("overlay").classList.add("show");
}

function closeCart() {
  document.getElementById("cartPanel").classList.remove("open");
  document.getElementById("overlay").classList.remove("show");
}

document.getElementById("cartBtn").onclick = openCart;
document.getElementById("closeCart").onclick = closeCart;
document.getElementById("overlay").onclick = closeCart;

document.getElementById("checkout").onclick = () => {
  alert("تم تجهيز الطلب. سنربط طريقة الدفع لاحقًا.");
};

search.oninput = () => {
  const q = search.value.trim();

  render(
    products.filter(p => p.name.includes(q))
  );
};

render();
updateCart();
