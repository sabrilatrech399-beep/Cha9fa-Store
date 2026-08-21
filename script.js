const products=[
 {id:1,name:"منتج تجريبي 1",price:1000,icon:"🔥"},
 {id:2,name:"منتج تجريبي 2",price:2000,icon:"⭐"},
 {id:3,name:"منتج تجريبي 3",price:3000,icon:"🎁"},
 {id:4,name:"منتج تجريبي 4",price:5000,icon:"💎"}
];
let cart=[];
const grid=document.getElementById("productsGrid"), search=document.getElementById("search");
function render(list=products){
 grid.innerHTML=list.map(p=>`<article class="card"><div class="product-img">${p.icon}</div><h3>${p.name}</h3><div class="price">${p.price.toLocaleString()} دج</div><button class="add" onclick="addToCart(${p.id})">أضف إلى السلة</button></article>`).join("");
}
function addToCart(id){cart.push(products.find(p=>p.id===id));updateCart();}
function updateCart(){
 document.getElementById("cartCount").textContent=cart.length;
 document.getElementById("cartItems").innerHTML=cart.length?cart.map((p,i)=>`<div class="cart-item"><span>${p.name}</span><span>${p.price.toLocaleString()} دج <button onclick="removeItem(${i})">✕</button></span></div>`).join(""):"<p style='color:#9ca3af'>السلة فارغة.</p>";
 document.getElementById("cartTotal").textContent=cart.reduce((s,p)=>s+p.price,0).toLocaleString()+" دج";
}
function removeItem(i){cart.splice(i,1);updateCart();}
function openCart(){document.getElementById("cartPanel").classList.add("open");document.getElementById("overlay").classList.add("show")}
function closeCart(){document.getElementById("cartPanel").classList.remove("open");document.getElementById("overlay").classList.remove("show")}
document.getElementById("cartBtn").onclick=openCart;
document.getElementById("closeCart").onclick=closeCart;
document.getElementById("overlay").onclick=closeCart;
document.getElementById("checkout").onclick=()=>alert("تم تجهيز السلة. سنربط طريقة الطلب/الدفع لاحقًا.");
search.oninput=()=>{const q=search.value.trim();render(products.filter(p=>p.name.includes(q)))};
render();updateCart();
